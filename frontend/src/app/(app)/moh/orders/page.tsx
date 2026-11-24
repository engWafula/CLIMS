import StockoutsPage from '@/features/dcfp/StockoutsPage';
import { pageMetadata } from '@/navigation/pageMetadata';

export const metadata = pageMetadata('/moh/orders');

export default function Page() {
  return <StockoutsPage scope="national" />;
}
