import { appIcon } from "@/lib/app-icon";

export const dynamic = "force-static";
export const generateStaticParams = () => [{ size: "192" }, { size: "512" }];

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  return appIcon(size === "512" ? 512 : 192);
}
