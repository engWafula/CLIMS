import WarehouseOrderPage from '@/features/dcfp/WarehouseOrderPage';
import { pageMetadata } from '@/navigation/pageMetadata';

export const metadata = pageMetadata('/moh/orders/warehouse/[id]');

export default function Page() {
  return <WarehouseOrderPage scope="national" />;
}
