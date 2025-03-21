export const config = {
  runtime: 'edge',
};

const domain = "obscurative.ru";
const proxyToRaw : Record<string, string> = {
  "scientific-alliance": "scientific-alliance"
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
  result.push({ from: "http://d3g0gp89917ko0.cloudfront.net", to: "https://d3g0gp89917ko0.cloudfront.net" });
  for (const proxy in proxyTo) {
    result.push( { from: new RegExp(`(["\']|:\\\/\\\/)${proxyTo[proxy]}`, "g"), to: `$1${proxy}.wd.${domain}` } );
    result.push( { from: `http://${proxyTo[proxy]}`, to: `https://${proxy}`});
  }
  return result;
})();

export default async function handler(request: Request): Promise<Response> {
  const url: URL = new URL(request.url);
  const space_host = url.hostname.split(".wd.");
  if (space_host.length != 2) // Questionable
    return errResp;

  const to: string | null = proxyTo[space_host[0]];
  if (to == null)
    return errResp;

  let forwardedRequest = new Request(`http${space_host[0] == wikidotSpaceName ? "s" : ""}://${to}${url.pathname}`, request);
  console.log(JSON.stringify(forwardedRequest));

  try {
    const resp = await fetch(forwardedRequest);

    const contentType = resp.headers.get('Content-Type') || 'text/plain';
    if (contentType.startsWith("text/")) {
      let respText = await resp.text();
      // Not optimal?
      for (let subst of substitutions) {
        respText = respText.replaceAll(subst.from, subst.to);
      }
      return new Response(respText, resp);
    } else {
      return resp;
    }
  } catch (error) {
    console.error(error);
    return errResp;
  }
}
