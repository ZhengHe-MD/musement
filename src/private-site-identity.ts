export const privateSiteIdentityHeader = "x-musement-private-site";
export const privateSiteIdentity = "current-edition-v1";

export function isPrivateSiteResponse(response: Response): boolean {
  return response.headers.get(privateSiteIdentityHeader) === privateSiteIdentity;
}
