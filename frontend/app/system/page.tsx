import { Workspace } from '../../components/workspace';

export const dynamic = 'force-dynamic';

export default function System() {
  return <Workspace systemView testLoginEnabled={process.env.NEXT_PUBLIC_TEST_LOGIN_ENABLED === 'true'}
    accountNotice={process.env.ACCOUNT_NOTICE ?? ''} />;
}
