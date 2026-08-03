import { SiteHeader } from "@/components/site-header";
import { MenuBrowser } from "@/components/menu-browser";

export default async function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 pb-28">
        <MenuBrowser slug={slug} />
      </main>
    </>
  );
}
