import { Workspace } from '../../components/workspace';

export const dynamic = 'force-dynamic';

export default function System() {
  return <Workspace systemView accountNotice={process.env.ACCOUNT_NOTICE ?? ''} />;
}
