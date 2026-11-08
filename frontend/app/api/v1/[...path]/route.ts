import { proxyBusiness } from '../../../../lib/business-proxy.server';

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  return proxyBusiness(request, (await context.params).path);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
