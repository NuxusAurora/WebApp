import { Workspace } from '../components/workspace';

export default function Home() {
  return <Workspace testLoginEnabled={process.env.NEXT_PUBLIC_TEST_LOGIN_ENABLED === 'true'} />;
}
