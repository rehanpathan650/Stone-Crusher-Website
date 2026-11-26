import DataRoute from '../../../ui/components/DataRoute.jsx';

/** List pages (sales, purchases, weighbridge, …) share one screen, configured in ui/resources.jsx. */
export default async function Page({ params }) {
  const { resource } = await params;
  return <DataRoute name={resource} />;
}
