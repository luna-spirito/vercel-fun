import Fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import authPlugin from "@fastify/auth";
import { readFileSync } from "fs";
import { fetch, setGlobalDispatcher, ProxyAgent } from "undici";
import { z } from "zod";

const ConfigSchema = z.object({
  port: z.number().default(443),
  host: z.string().default("0.0.0.0"),
  domain: z.string(),
  ssl: z
    .object({
      certPath: z.string(),
      keyPath: z.string(),
    })
    .optional(),
  proxy: z
    .object({
      url: z.string(),
    })
    .optional(),
});

type Config = z.infer<typeof ConfigSchema>;

const configPath = process.argv[2] || "./config.json";
let config: Config;
try {
  config = ConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf-8")));
} catch (e) {
  console.error("Failed to load config:", e);
  process.exit(1);
}

const auth = {
  username: process.env.PROXY_USERNAME,
  password: process.env.PROXY_PASSWORD,
};

if (!auth.username || !auth.password) {
  console.error(
    "Error: Proxy credentials must be provided via PROXY_USERNAME/PROXY_PASSWORD env vars.",
  );
  process.exit(1);
}

const proxyToRaw: Record<string, string> = {
  "scientific-alliance": "scientific-alliance",
  "andivion-sandbox": "andivion-sandbox",
  "andivion-studio": "andivion-studio",
  secretnamesofstairs: "secretnamesofstairs",
  ambarra: "ambarra",
};
const wikidotSpaceName = "wikidot-proxy";

const proxyTo: Record<string, string> = (() => {
  let result: Record<string, string> = {};
  result[wikidotSpaceName] = "www.wikidot.com";
  for (const proxy in proxyToRaw) {
    result[`${proxy}`] = `${proxyToRaw[proxy]}.wikidot.com`;
    result[`files.${proxy}`] = `${proxyToRaw[proxy]}.wdfiles.com`;
  }
  return result;
})();

const substitutions: { from: string | RegExp; to: string }[] = (() => {
  let result: { from: string | RegExp; to: string }[] = [];
  result.push({
    from: /http:(\/\/|\\\/\\\/)d3g0gp89917ko0.cloudfront.net/g,
    to: "https:$1d3g0gp89917ko0.cloudfront.net",
  });
  const portSuffix = config.port === 443 ? "" : `:${config.port}`;
  for (const proxy in proxyTo) {
    result.push({
      from: `http://${proxyTo[proxy]}`,
      to: `https://${proxy}${config.domain}${portSuffix}`,
    });
    result.push({
      from: new RegExp(`(["\']|:\\\/\\\/)${proxyTo[proxy]}`, "g"),
      to: `$1${proxy}${config.domain}${portSuffix}`,
    });
  }
  return result;
})();

async function main() {
  // Setup Outgoing Proxy
  if (config.proxy) {
    const agent = new ProxyAgent(config.proxy.url);
    setGlobalDispatcher(agent);
  }

  const fastify = Fastify({
    logger: true,
    https: config.ssl
      ? {
          cert: readFileSync(config.ssl.certPath),
          key: readFileSync(config.ssl.keyPath),
        }
      : null,
  } as any);

  // Register plugins and wait for them
  await fastify.register(authPlugin);
  await fastify.register(basicAuth, {
    validate: (
      username: string,
      password: string,
      req: any,
      reply: any,
      done: any,
    ) => {
      if (username === auth.username && password === auth.password) {
        done();
      } else {
        done(new Error("Unauthorized"));
      }
    },
    authenticate: true,
  });

  // Now decorators should be available
  fastify.addHook(
    "onRequest",
    (fastify as any).auth([(fastify as any).basicAuth]),
  );

  fastify.addContentTypeParser("*", (request, payload, done) => {
    done(null, payload);
  });

  fastify.all("*", async (request, reply) => {
    const url = new URL(request.url, `https://${request.hostname}`);
    const space_host = request.hostname.split(config.domain);

    if (space_host.length !== 2) {
      return reply.status(500).send("Invalid Hostname");
    }

    const to: string | null = proxyTo[space_host[0]];
    if (!to) {
      return reply.status(500).send("Unknown Upstream");
    }

    const upstreamUrl = `http${space_host[0] === wikidotSpaceName ? "s" : ""}://${to}${url.pathname}${url.search}`;

    try {
      const headers = { ...request.headers } as Record<string, string>;
      delete headers.host;
      delete headers.authorization;
      delete headers.connection;

      const resp = await fetch(upstreamUrl, {
        method: request.method,
        headers: headers,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? (request.body as any)
            : undefined,
      });

      const contentType = resp.headers.get("Content-Type") ?? "text/plain";
      let body: any;

      if (contentType.startsWith("text/")) {
        let respText = await resp.text();
        for (let subst of substitutions) {
          respText = respText.replaceAll(subst.from, subst.to);
        }
        body = respText;
      } else {
        body = Buffer.from(await resp.arrayBuffer());
      }

      const respHeaders = Object.fromEntries(resp.headers.entries());
      delete respHeaders["content-encoding"];
      delete respHeaders["transfer-encoding"];
      delete respHeaders["content-length"];

      // Handle Set-Cookie
      const setCookies = resp.headers.getSetCookie();
      if (setCookies.length > 0) {
        const modifiedCookies = setCookies.map(
          (cookie) =>
            encodeURI(cookie.replace(".wikidot.com", config.domain)) +
            "; SameSite=Lax",
        );
        reply.header("Set-Cookie", modifiedCookies);
      }

      // Set other headers
      for (const [key, value] of Object.entries(respHeaders)) {
        if (key.toLowerCase() !== "set-cookie") {
          reply.header(key, value);
        }
      }

      return reply.status(resp.status).send(body);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send("Proxy Error");
    }
  });

  try {
    await fastify.listen({ port: config.port, host: config.host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
