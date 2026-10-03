import type { ChannelId } from "@/lib/channels";
import { google } from "./google";
import { facebook, instagram } from "./meta";
import { email, sms } from "./messaging";
import { tiktok } from "./tiktok";
import type { Publisher } from "./types";
import { wordpress } from "./wordpress";

export const PUBLISHERS: Record<ChannelId, Publisher> = {
  facebook,
  instagram,
  tiktok,
  google,
  seo: wordpress,
  email,
  sms,
};
