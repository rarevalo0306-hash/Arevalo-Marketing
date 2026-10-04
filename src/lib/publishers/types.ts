import type { MediaType } from "@/lib/channels";

export type Creds = Record<string, string>;

export type PublishInput = {
  text: string;
  subject: string;
  seoTitle: string;
  mediaType: MediaType;
  /** URL pública y absoluta del archivo, o "" si no hay. */
  mediaUrl: string;
  businessName: string;
  contacts: { name: string; email: string; phone: string; emailOptIn: boolean; smsOptIn: boolean }[];
};

export type PublishResult = { url?: string; detail: string };

export type Publisher = {
  publish(input: PublishInput, creds: Creds): Promise<PublishResult>;
  /** Comprueba las credenciales sin publicar nada. Devuelve un texto como "Conectado como …". */
  test(creds: Creds): Promise<string>;
};
