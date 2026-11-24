import FieldUsersPage from '@/features/dcfp/FieldUsersPage';
import { pageMetadata } from '@/navigation/pageMetadata';

export const metadata = pageMetadata('/dcfp/users');

export default function Page() {
  return <FieldUsersPage />;
}
