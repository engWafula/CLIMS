import WarehouseOrdersPage from '@/features/dcfp/WarehouseOrdersPage';
import { pageMetadata } from '@/navigation/pageMetadata';

export const metadata = pageMetadata('/moh/orders/warehouse');

export default function Page() {
  return <WarehouseOrdersPage scope="national" />;
}
