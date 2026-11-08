import { proxyProbe } from '../../../../lib/proxy.server';
export const dynamic = 'force-dynamic';
export async function GET() { return proxyProbe('ready'); }
