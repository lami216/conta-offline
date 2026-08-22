export const LOCAL_OWNER={id:"local-owner",kind:"desktop-owner" as const};
export type OwnerCapability="settings.backup.manage"|"settings.legacy.import";
/** Authorization seam for future desktop roles. This release has one OS-local owner. */
export function requireCapability(_request:Request,_capability:OwnerCapability){return null}
export function sessionFromRequest(_request:Request){return LOCAL_OWNER}
export function validSameOrigin(request:Request){const origin=request.headers.get("origin");if(!origin)return false;try{const requested=new URL(request.url),source=new URL(origin);return source.hostname==="127.0.0.1"&&requested.hostname==="127.0.0.1"&&source.port===requested.port}catch{return false}}
