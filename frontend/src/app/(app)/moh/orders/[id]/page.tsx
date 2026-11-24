import StockoutRequestPage from '@/features/dcfp/StockoutRequestPage';
import { pageMetadata } from '@/navigation/pageMetadata';

export const metadata = pageMetadata('/moh/orders/[id]');

export default function Page() {
  return <StockoutRequestPage scope="national" />;
}
