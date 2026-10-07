import type { ChannelId } from "@/lib/channels";
import { linkedin } from "@/lib/publish-linkedin";
import { x } from "@/lib/publish-x";
import { google } from "./google";
import { facebook, instagram } from "./meta";
import { email, sms } from "./messaging";
import { tiktok } from "./tiktok";
import type { Publisher } from "./types";
import { website } from "./website";

export const PUBLISHERS: Record<ChannelId, Publisher> = {
  facebook,
  instagram,
  tiktok,
  google,
  seo: website,
  linkedin,
  x,
  email,
  sms,
};
