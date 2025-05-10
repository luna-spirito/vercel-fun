export const config = {
  runtime: 'edge',
};

const domain = ".wd.obscurative.ru";
const proxyToRaw : Record<string, string> = {
  "scientific-alliance": "scientific-alliance",
  "andivion-sandbox": "andivion-sandbox"
};
const wikidotSpaceName = "wikidot";

const proxyTo : Record<string, string> = (() => {
  let result = {};
  result[wikidotSpaceName] = "www.wikidot.com";
  for (const proxy in proxyToRaw) {
    result[`${proxy}`] = `${proxyToRaw[proxy]}.wikidot.com`;
    result[`files.${proxy}`] = `${proxyToRaw[proxy]}.wdfiles.com`;
  }
  return result;
})();

const errResp = new Response(null, { status: 500 });

const substitutions : { from: string | RegExp, to: string }[] = (() => {
  let result : { from: string | RegExp, to: string }[] = [];
  result.push({ from: /http:(\/\/|\\\/\\\/)d3g0gp89917ko0.cloudfront.net/g, to: "https:$1d3g0gp89917ko0.cloudfront.net" });
  for (const proxy in proxyTo) {
    result.push( { from: `http://${proxyTo[proxy]}`, to: `https://${proxy}${domain}`});
    result.push( { from: new RegExp(`(["\']|:\\\/\\\/)${proxyTo[proxy]}`, "g"), to: `$1${proxy}${domain}` } );
  }
  return result;
})();

export default async function handler(request: Request): Promise<Response> {
  const url: URL = new URL(request.url);
  const space_host = url.hostname.split(domain);
  if (space_host.length != 2) // Questionable
    return errResp;

  const to: string | null = proxyTo[space_host[0]];
  if (to == null)
    return errResp;

  let forwardedRequest = new Request(`http${space_host[0] == wikidotSpaceName ? "s" : ""}://${to}${url.pathname}${url.search}`, request);

  try {
    const resp = await fetch(forwardedRequest);

    const contentType = resp.headers.get("Content-Type") ?? "text/plain";
    let body;
    if (contentType.startsWith("text/")) {
      let respText = await resp.text();
      // Not optimal?
      for (let subst of substitutions) {
        respText = respText.replaceAll(subst.from, subst.to);
      }
      body = respText;
    } else {
      body = resp.body;
    }

    let headers = resp.headers;
    const setCookies = headers.getSetCookie(); // I hate imperative programming.
    headers.delete("Set-Cookie");
    for (const setCookie of setCookies) {
      headers.append("Set-Cookie", `${setCookie.replace(".wikidot.com", domain)}; SameSite=Lax`);
    }

    return new Response(body, {
      status: resp.status,
      headers
    })
  } catch (error) {
    console.error(error);
    return errResp;
  }
}
