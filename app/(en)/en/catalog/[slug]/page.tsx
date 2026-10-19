import { productRoute } from '@/components/catalog/productRoute';

const route = productRoute('en');

// Only the slugs of the build's snapshot exist: the export is static.
export const dynamicParams = false;
export const generateStaticParams = route.generateStaticParams;
export const generateMetadata = route.generateMetadata;
export default route.Page;
