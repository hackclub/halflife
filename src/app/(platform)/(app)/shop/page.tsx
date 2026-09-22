import type { Metadata } from "next";
import { PageSign } from "@/components/platform/PageSign";
import { ShopGrid } from "./ShopGrid";
import { requireSessionPage } from "@/lib/page-guards";
import { getShopItemsFor } from "@/lib/shop";

export const metadata: Metadata = {
  title: "Half Life Shop",
  description: "Spend the coins you banked on grants, tools, parts and swag.",
};

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const { user } = await requireSessionPage();
  const { items } = await getShopItemsFor(user.id);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pt-2 sm:px-8">
      <PageSign
        label="SHOP"
        color="var(--color-orange)"
        sub={
          <>
            Do not see what you are looking for? Suggest it in the{" "}
            <a
              href="#"
              className="font-semibold text-navy underline decoration-dashed underline-offset-4 hover:text-coral"
            >
              shop items canvas on Slack
            </a>
            .
          </>
        }
      />
      <ShopGrid items={items} />
    </div>
  );
}
