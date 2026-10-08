// Los textos de cada problema de la auditoría: título y «cómo arreglarlo» en palabras simples (para el dueño), y la
// versión técnica para la IA que maneja la página. Puro: lo usan el panel, el PDF, las alertas y el plan de acción.
import type { IssueId } from "@/lib/seo/audit-ids";

export type IssueCopy = { title: string; fix: string };
type Bi = { es: string; en: string };

export const ISSUE_TEXT: Record<IssueId, { es: IssueCopy; en: IssueCopy }> = {
  "page-errors": {
    es: { title: "Páginas que no abren", fix: "Algunas páginas dan error (por ejemplo, «no encontrada»). Arréglalas o haz que lleven a una página que sí exista, y quita los enlaces que apuntan a ellas." },
    en: { title: "Pages that don't load", fix: "Some pages return an error (like \"not found\"). Fix them or redirect them to a page that exists, and remove links pointing to them." },
  },
  "broken-links": {
    es: { title: "Enlaces rotos", fix: "Hay enlaces en tu página que llevan a páginas que no existen. Cámbialos por la dirección correcta o quítalos." },
    en: { title: "Broken links", fix: "Some links on your site go to pages that don't exist. Point them to the right address or remove them." },
  },
  "missing-title": {
    es: { title: "Páginas sin título", fix: "Cada página necesita su propio título de 50 a 60 letras que diga de qué trata y tu ciudad. Es lo que sale en azul en Google." },
    en: { title: "Pages without a title", fix: "Each page needs its own title of 50-60 characters that says what the page is about and your city. It's the blue headline people see on Google." },
  },
  "no-https": {
    es: { title: "Sin conexión segura (https)", fix: "Tu página debe abrir con https (el candado). Pídele a quien maneja tu hosting que active el certificado SSL gratis y que http mande siempre a https." },
    en: { title: "No secure connection (https)", fix: "Your site should open with https (the padlock). Ask whoever runs your hosting to turn on a free SSL certificate and send all http visits to https." },
  },
  "http-no-redirect": {
    es: { title: "La versión http no manda a https", fix: "Tu página abre con https, pero si alguien entra por http se queda en la versión sin candado. Pídele a quien maneja tu hosting que mande siempre http a https." },
    en: { title: "http doesn't redirect to https", fix: "Your site opens with https, but anyone who comes in through http stays on the version without the padlock. Ask whoever runs your hosting to always send http to https." },
  },
  "no-viewport": {
    es: { title: "No se adapta al celular", fix: "Falta la etiqueta que hace que la página se vea bien en el celular. Pídele a tu diseñador que agregue la etiqueta «viewport»; Google da prioridad a las páginas que se ven bien en el teléfono." },
    en: { title: "Not mobile-friendly", fix: "The tag that makes the page fit on phones is missing. Ask your web designer to add the \"viewport\" tag; Google favors pages that work well on phones." },
  },
  noindex: {
    es: { title: "Páginas escondidas de Google", fix: "Estas páginas le dicen a Google que no las muestre (noindex). Si quieres que la gente las encuentre, quita esa opción en tu editor de página." },
    en: { title: "Pages hidden from Google", fix: "These pages tell Google not to show them (noindex). If you want people to find them, turn that setting off in your website editor." },
  },
  "duplicate-title": {
    es: { title: "Títulos repetidos", fix: "Varias páginas tienen el mismo título. Dale a cada una un título distinto que diga el servicio específico y tu ciudad." },
    en: { title: "Duplicate titles", fix: "Several pages share the same title. Give each one a different title that names the specific service and your city." },
  },
  "title-too-long": {
    es: { title: "Títulos muy largos", fix: "Google corta los títulos de más de 60 letras. Acórtalos y pon primero lo más importante: el servicio y la ciudad." },
    en: { title: "Titles too long", fix: "Google cuts off titles longer than 60 characters. Shorten them and put the most important part first: the service and the city." },
  },
  "missing-description": {
    es: { title: "Sin descripción", fix: "Escribe para cada página una descripción de 120 a 155 letras que invite a hacer clic: qué ofreces, dónde y por qué elegirte. Es el texto gris debajo del título en Google." },
    en: { title: "Missing description", fix: "Write a 120-155 character description for each page that makes people want to click: what you offer, where, and why choose you. It's the gray text under the title on Google." },
  },
  "duplicate-description": {
    es: { title: "Descripciones repetidas", fix: "Varias páginas tienen la misma descripción. Escribe una distinta para cada página, según lo que ofrece esa página." },
    en: { title: "Duplicate descriptions", fix: "Several pages share the same description. Write a different one for each page, based on what that page offers." },
  },
  "missing-h1": {
    es: { title: "Sin título principal (H1)", fix: "Cada página necesita un título grande arriba (H1) que diga de qué trata, por ejemplo «Reparación de techos en Miami»." },
    en: { title: "Missing main heading (H1)", fix: "Each page needs one big heading at the top (H1) that says what it's about, like \"Roof Repair in Miami\"." },
  },
  "images-no-alt": {
    es: { title: "Fotos sin descripción (alt)", fix: "Agrega a cada foto una descripción corta de lo que muestra (texto alternativo). Ayuda a salir en Google Imágenes y a las personas con problemas de vista." },
    en: { title: "Images without alt text", fix: "Add a short description of what each photo shows (alt text). It helps you show up in Google Images and helps people with low vision." },
  },
  "slow-page": {
    es: { title: "Páginas lentas", fix: "Estas páginas tardan más de 3 segundos en responder. Usa fotos más livianas, quita lo que no uses y considera un hosting más rápido." },
    en: { title: "Slow pages", fix: "These pages take more than 3 seconds to respond. Use lighter photos, remove what you don't use, and consider faster hosting." },
  },
  "no-sitemap": {
    es: { title: "Sin mapa del sitio (sitemap)", fix: "Un sitemap le dice a Google qué páginas tienes. La mayoría de los editores (WordPress, Wix, Squarespace) lo crean solos: actívalo y envíalo en Google Search Console." },
    en: { title: "No sitemap", fix: "A sitemap tells Google which pages you have. Most website builders (WordPress, Wix, Squarespace) make one for you: turn it on and submit it in Google Search Console." },
  },
  "no-structured-data": {
    es: { title: "Google no sabe que eres un negocio local", fix: "Agrega a tu página de inicio los datos del negocio en formato de Google (LocalBusiness): nombre, dirección, teléfono y horario. Ayuda a salir en el mapa y en las IAs." },
    en: { title: "Google can't tell you're a local business", fix: "Add your business details to your home page in Google's format (LocalBusiness): name, address, phone and hours. It helps you show up on the map and in AI answers." },
  },
  "title-too-short": {
    es: { title: "Títulos muy cortos", fix: "Un título de menos de 20 letras desperdicia espacio. Agrega el servicio y tu ciudad, por ejemplo «Plomero en Doral | Tu Negocio»." },
    en: { title: "Titles too short", fix: "A title under 20 characters wastes space. Add the service and your city, like \"Plumber in Doral | Your Business\"." },
  },
  "description-length": {
    es: { title: "Descripción muy corta o muy larga", fix: "La descripción funciona mejor con 120 a 155 letras: menos dice muy poco y más se corta en Google." },
    en: { title: "Description too short or too long", fix: "Descriptions work best at 120-155 characters: shorter says too little and longer gets cut off on Google." },
  },
  "multiple-h1": {
    es: { title: "Más de un título principal (H1)", fix: "Usa un solo título grande (H1) por página y los demás como subtítulos (H2), para que Google entienda cuál es el tema." },
    en: { title: "More than one main heading (H1)", fix: "Use just one big heading (H1) per page and make the others subheadings (H2), so Google knows what the main topic is." },
  },
  "thin-content": {
    es: { title: "Poco texto", fix: "Estas páginas tienen menos de 250 palabras. Explica mejor el servicio: qué incluye, a quién ayudas, en qué zonas trabajas y preguntas frecuentes." },
    en: { title: "Not much text", fix: "These pages have fewer than 250 words. Explain the service better: what's included, who you help, the areas you serve, and common questions." },
  },
  "no-og-image": {
    es: { title: "Sin foto al compartir", fix: "Cuando alguien comparte tu página en Facebook o WhatsApp no sale foto. Elige una imagen para compartir (og:image) en tu editor de página." },
    en: { title: "No image when shared", fix: "When someone shares your page on Facebook or WhatsApp, no photo shows up. Pick a sharing image (og:image) in your website editor." },
  },
  "missing-lang": {
    es: { title: "No dice en qué idioma está", fix: "La página no indica su idioma. Pídele a tu diseñador que lo marque (por ejemplo, lang=\"es\") para que Google la muestre a quien habla ese idioma." },
    en: { title: "Language not set", fix: "The page doesn't say what language it's in. Ask your web designer to set it (for example, lang=\"en\") so Google shows it to the right people." },
  },
  "no-robots": {
    es: { title: "Sin archivo robots.txt", fix: "Es un archivo pequeño que guía a Google por tu página y le dice dónde está el sitemap. Casi todos los editores lo pueden crear; no es urgente." },
    en: { title: "No robots.txt file", fix: "It's a small file that guides Google through your site and points to your sitemap. Most website builders can create it; it's not urgent." },
  },

  // ---------- versión 2 ----------
  "robots-blocks-site": {
    es: { title: "Tu página le prohíbe la entrada a Google", fix: "El archivo robots.txt le dice a Google que no lea tu página (Disallow: /). Así no puedes salir en las búsquedas. Pídele a quien maneja tu página que quite esa línea." },
    en: { title: "Your site tells Google to stay out", fix: "Your robots.txt file tells Google not to read your site (Disallow: /). That keeps you out of search results. Ask whoever runs your website to remove that line." },
  },
  "schema-invalid-json": {
    es: { title: "Datos para Google con errores de escritura", fix: "Los datos del negocio que la página le da a Google (JSON-LD) tienen un error de escritura y Google no los puede leer. Revísalos con la «Prueba de resultados enriquecidos» de Google y corrígelos." },
    en: { title: "Data for Google has typos", fix: "The business data the page gives Google (JSON-LD) has a typo and Google can't read it. Check it with Google's \"Rich Results Test\" and fix it." },
  },
  "mixed-content": {
    es: { title: "Partes sin candado dentro de páginas seguras", fix: "Estas páginas abren con https, pero cargan fotos o archivos por http (sin candado). El navegador puede bloquearlos o mostrar «no seguro». Cambia esas direcciones a https." },
    en: { title: "Insecure parts on secure pages", fix: "These pages open with https but load photos or files over http (no padlock). Browsers may block them or show \"not secure\". Change those addresses to https." },
  },
  "www-mismatch": {
    es: { title: "Tu página abre con y sin «www»", fix: "Tu página responde igual con www y sin www, como si fueran dos sitios. Elige una versión y haz que la otra mande siempre a ella (redirección 301)." },
    en: { title: "Your site opens with and without \"www\"", fix: "Your site answers both with and without www, as if it were two sites. Pick one and make the other always send visitors to it (301 redirect)." },
  },
  "wp-junk-urls": {
    es: { title: "Páginas viejas de WordPress todavía abiertas", fix: "Quedan direcciones del WordPress viejo (autor, categoría, etiquetas, archivos por mes, «sin categoría», feed) que Google puede seguir mostrando. Haz que cada una mande a la página nueva que más se parezca (301) o que diga «ya no existe» (410), quítalas del sitemap y pide quitarlas en Google Search Console." },
    en: { title: "Old WordPress pages still open", fix: "Addresses from the old WordPress site (author, category, tag, monthly archives, \"uncategorized\", feed) are still reachable and Google may keep showing them. Send each one to the closest new page (301) or mark it as gone (410), remove them from the sitemap and ask Google Search Console to remove them." },
  },
  "sitemap-bad-urls": {
    es: { title: "El sitemap tiene direcciones que no sirven", fix: "Tu mapa del sitio le pide a Google que lea direcciones que dan error, que mandan a otra página o que están escondidas. Deja en el sitemap solo las páginas buenas y finales." },
    en: { title: "The sitemap lists addresses that don't work", fix: "Your sitemap asks Google to read addresses that return errors, redirect somewhere else or are hidden. Keep only good, final pages in the sitemap." },
  },
  "schema-wrong-property": {
    es: { title: "Datos para Google en el lugar equivocado", fix: "Los datos del negocio tienen campos que no van ahí: las herramientas de revisión (como Semrush o el validador de schema.org) lo marcan como error y Google no los usa. Por ejemplo, los idiomas que atiendes («availableLanguage») van dentro del contacto (contactPoint), no directo en el negocio. Muévelos al lugar correcto." },
    en: { title: "Data for Google in the wrong place", fix: "The business data has fields that don't belong there: checking tools (like Semrush or the schema.org validator) flag them as errors and Google ignores them. For example, the languages you speak (\"availableLanguage\") go inside the contact point (contactPoint), not directly on the business. Move them to the right place." },
  },
  "schema-business-incomplete": {
    es: { title: "Faltan datos del negocio para Google", fix: "Los datos del negocio (LocalBusiness) no tienen todo lo básico: nombre, dirección, teléfono y página web. Complétalos con los mismos datos de tu Perfil de Google." },
    en: { title: "Business data for Google is incomplete", fix: "The business data (LocalBusiness) is missing basics: name, address, phone and website. Fill them in with the same details as your Google Business Profile." },
  },
  "schema-opening-hours": {
    es: { title: "El horario para Google está mal escrito", fix: "El horario que la página le da a Google no tiene el formato correcto, así que Google no lo entiende. Debe ser como «Mo-Fr 09:00-18:00», o con días en inglés y horas de 00:00 a 23:59." },
    en: { title: "Opening hours for Google are badly written", fix: "The opening hours the page gives Google aren't in the right format, so Google can't understand them. They should look like \"Mo-Fr 09:00-18:00\", or use English day names and 00:00-23:59 times." },
  },
  "ai-search-bots-blocked": {
    es: { title: "Bloqueas a buscadores con IA", fix: "Tu robots.txt no deja entrar a los robots que usan ChatGPT, Perplexity o Claude para buscar y citar páginas. Si quieres que las IAs te recomienden, quítales el bloqueo." },
    en: { title: "You block AI search engines", fix: "Your robots.txt blocks the bots ChatGPT, Perplexity or Claude use to search and quote pages. If you want AIs to recommend you, unblock them." },
  },
  "duplicate-content": {
    es: { title: "Páginas con el mismo texto", fix: "Varias páginas tienen exactamente el mismo texto. Google elige solo una y las demás no salen. Escribe un texto propio para cada una, o deja una sola y haz que las otras manden a ella." },
    en: { title: "Pages with the same text", fix: "Several pages have exactly the same text. Google picks just one and the others don't show. Write unique text for each, or keep one and redirect the others to it." },
  },
  "broken-images": {
    es: { title: "Fotos que no cargan", fix: "Estas fotos dan error y salen como un cuadro vacío. Vuelve a subirlas o quítalas de la página." },
    en: { title: "Images that don't load", fix: "These images return an error and show up as an empty box. Upload them again or remove them from the page." },
  },
  "wp-com-links": {
    es: { title: "Muchos enlaces a WordPress.com", fix: "Tu página tiene enlaces o fotos que dependen de wp.com o wordpress.com (restos del sitio viejo). Sube esas fotos a tu propia página y cambia o quita esos enlaces." },
    en: { title: "Many links to WordPress.com", fix: "Your site has links or images that depend on wp.com or wordpress.com (leftovers from the old site). Upload those images to your own site and change or remove those links." },
  },
  "hreflang-missing": {
    es: { title: "Google no sabe qué página es de cada idioma", fix: "Tienes páginas en dos idiomas, pero no le dices a Google cuál es la versión en español y cuál en inglés (hreflang). Agrégalo para que cada persona vea la página en su idioma." },
    en: { title: "Google can't tell which page is which language", fix: "You have pages in two languages but don't tell Google which version is Spanish and which is English (hreflang). Add it so each person sees the page in their language." },
  },
  "orphan-pages": {
    es: { title: "Páginas sin enlaces desde tu sitio", fix: "Estas páginas están en el sitemap, pero ninguna de las páginas que leímos enlaza a ellas. La gente no las encuentra y Google las ve menos importantes. Enlázalas desde el menú o desde páginas relacionadas." },
    en: { title: "Pages nothing links to", fix: "These pages are in the sitemap, but none of the pages we read link to them. People can't find them and Google sees them as less important. Link to them from the menu or related pages." },
  },
  "deep-pages": {
    es: { title: "Páginas muy escondidas (más de 3 clics)", fix: "Para llegar a estas páginas desde el inicio hacen falta más de 3 clics. Enlázalas desde el menú, el pie de página o páginas principales." },
    en: { title: "Pages buried too deep (more than 3 clicks)", fix: "These pages take more than 3 clicks to reach from the home page. Link to them from the menu, the footer or main pages." },
  },
  "single-inlink": {
    es: { title: "Páginas con un solo enlace interno", fix: "Solo una página de tu sitio enlaza a estas. Agrega enlaces desde otras páginas relacionadas para que Google las vea más importantes." },
    en: { title: "Pages with only one internal link", fix: "Only one page on your site links to these. Add links from other related pages so Google sees them as more important." },
  },
  "ai-training-bots-blocked": {
    es: { title: "Bloqueas a robots que entrenan IAs", fix: "Tu robots.txt bloquea a robots que leen páginas para entrenar IAs (por ejemplo GPTBot o Google-Extended). No te quita de Google, pero las IAs conocerán menos tu negocio. Decide si lo quieres así." },
    en: { title: "You block AI training bots", fix: "Your robots.txt blocks bots that read pages to train AIs (like GPTBot or Google-Extended). It doesn't remove you from Google, but AIs will know less about your business. Decide if that's what you want." },
  },
  "llms-txt-missing": {
    es: { title: "Falta el archivo para IAs (llms.txt)", fix: "llms.txt es un archivo corto que les resume a las IAs qué hace tu negocio y cuáles son tus páginas importantes. Crea /llms.txt con el nombre del negocio, una frase de qué haces y la lista de tus páginas principales." },
    en: { title: "No file for AIs (llms.txt)", fix: "llms.txt is a short file that tells AIs what your business does and which pages matter. Create /llms.txt with your business name, one sentence about what you do and a list of your main pages." },
  },
  "llms-txt-invalid": {
    es: { title: "El archivo para IAs (llms.txt) está mal armado", fix: "Tu /llms.txt existe pero no tiene la forma esperada: debe empezar con «# Nombre del negocio», seguir con una frase que empiece con «>» y luego listas de enlaces a tus páginas." },
    en: { title: "The AI file (llms.txt) is badly built", fix: "Your /llms.txt exists but isn't in the expected shape: it should start with \"# Business name\", then a line starting with \">\" summarizing what you do, then lists of links to your pages." },
  },
  "long-paragraphs": {
    es: { title: "Párrafos muy largos para las IAs", fix: "Estas páginas tienen párrafos de más de 150 palabras. A las IAs (y a la gente) les cuesta citarlos. Divídelos en párrafos cortos, con subtítulos y listas." },
    en: { title: "Paragraphs too long for AIs", fix: "These pages have paragraphs over 150 words. AIs (and people) find them hard to quote. Split them into short paragraphs with subheadings and lists." },
  },
  "weak-semantic-html": {
    es: { title: "Páginas sin estructura clara", fix: "A estas páginas les falta la estructura que usan Google y las IAs para entender el contenido: una zona principal (main o article) y subtítulos (H2). Pídele a quien maneja tu página que la agregue." },
    en: { title: "Pages without a clear structure", fix: "These pages lack the structure Google and AIs use to understand content: a main area (main or article) and subheadings (H2). Ask whoever runs your website to add it." },
  },
  "schema-org-incomplete": {
    es: { title: "Datos de la empresa o del sitio incompletos", fix: "Los datos de tu empresa (Organization) o de tu sitio (WebSite) no tienen nombre, página web o logo. Complétalos para que Google muestre bien tu marca." },
    en: { title: "Company or site data incomplete", fix: "Your company (Organization) or site (WebSite) data is missing a name, website or logo. Fill them in so Google shows your brand correctly." },
  },
  "h1-same-as-title": {
    es: { title: "El título grande es igual al título de Google", fix: "En estas páginas el título grande (H1) es idéntico al título que sale en Google. Está bien que se parezcan, pero usa palabras un poco distintas para cubrir más búsquedas." },
    en: { title: "Main heading equals the Google title", fix: "On these pages the main heading (H1) is identical to the title shown on Google. They can be similar, but use slightly different words to cover more searches." },
  },
  "low-text-ratio": {
    es: { title: "Mucho código y poco texto", fix: "En estas páginas el texto que se lee es menos del 10% de todo el código. Agrega texto útil o pídele a quien maneja tu página que quite código que no se usa." },
    en: { title: "Lots of code, little text", fix: "On these pages the readable text is under 10% of all the code. Add useful text or ask whoever runs your website to remove unused code." },
  },
  "too-many-links": {
    es: { title: "Demasiados enlaces en una página", fix: "Estas páginas tienen más de 250 enlaces. Google reparte su atención entre todos y la gente se pierde. Deja solo los enlaces útiles." },
    en: { title: "Too many links on a page", fix: "These pages have more than 250 links. Google splits its attention among all of them and people get lost. Keep only useful links." },
  },
  "large-html": {
    es: { title: "Páginas muy pesadas", fix: "El código de estas páginas pesa más de 2 MB, y tardan en abrir en el celular. Pídele a quien maneja tu página que lo aligere." },
    en: { title: "Very heavy pages", fix: "The code of these pages weighs more than 2 MB, so they're slow to open on phones. Ask whoever runs your website to slim it down." },
  },
};

/**
 * La versión técnica de «cómo arreglarlo» para la IA que programa la página (más técnica que ISSUE_TEXT).
 * prompts.ts la exporta también como AI_FIX.
 */
export const AUDIT_AI_FIX: Record<IssueId, Bi> = {
  "page-errors": {
    es: "Estas direcciones dan error (4xx/5xx). Arregla la página, o pon una redirección 301 a la página más parecida que sí funcione, y cambia los enlaces internos que apuntan a ellas.",
    en: "These URLs return an error (4xx/5xx). Fix the page, or add a 301 redirect to the closest working page, and update every internal link that points to them.",
  },
  "broken-links": {
    es: "Estos enlaces llevan a direcciones que dan error. En cada página donde aparecen, cámbialos por la dirección correcta o quítalos.",
    en: "These links point to URLs that return an error. On each page where they appear, change them to the correct URL or remove them.",
  },
  "missing-title": {
    es: "Agrega un <title> único de 50 a 60 caracteres que diga el servicio principal de la página y la ciudad.",
    en: "Add a unique <title> of 50-60 characters that says the page's main service and the city.",
  },
  "no-https": {
    es: "Haz que el sitio abra con https (certificado válido) y que toda visita por http:// vaya a https:// con una redirección 301.",
    en: "Make the site load over https (valid certificate) and send every http:// request to https:// with a 301 redirect.",
  },
  "http-no-redirect": {
    es: "Haz que http:// mande siempre a https:// con una redirección permanente (301).",
    en: "Make http:// always redirect to https:// with a permanent (301) redirect.",
  },
  "no-viewport": {
    es: 'Agrega <meta name="viewport" content="width=device-width, initial-scale=1"> en el <head> de todas las páginas.',
    en: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head> of every page.',
  },
  noindex: {
    es: "Estas páginas tienen «noindex» (meta robots o X-Robots-Tag), así que Google no las muestra. Si deben salir en Google, quítalo. Si esconderlas es a propósito (gracias, legales), déjalas.",
    en: "These pages have \"noindex\" (meta robots or X-Robots-Tag), so Google doesn't show them. If they should appear on Google, remove it. If hiding them is intentional (thank-you, legal pages), leave them.",
  },
  "duplicate-title": {
    es: "Varias páginas tienen el mismo <title>. Dale a cada una uno distinto (50 a 60 caracteres) con su servicio específico y la ciudad.",
    en: "Several pages share the same <title>. Give each one a different title (50-60 characters) with its specific service and the city.",
  },
  "title-too-long": {
    es: "Acorta el <title> a 60 caracteres como máximo, con el servicio y la ciudad al principio.",
    en: "Shorten the <title> to 60 characters max, with the service and the city first.",
  },
  "missing-description": {
    es: 'Agrega un <meta name="description"> único de 120 a 155 caracteres: qué ofrece la página, dónde y por qué elegir al negocio.',
    en: 'Add a unique <meta name="description"> of 120-155 characters: what the page offers, where, and why choose the business.',
  },
  "duplicate-description": {
    es: "Varias páginas tienen la misma meta descripción. Escribe una distinta para cada página, según lo que ofrece.",
    en: "Several pages share the same meta description. Write a different one for each page, based on what it offers.",
  },
  "missing-h1": {
    es: "Agrega un solo <h1> arriba que diga de qué trata la página (servicio + ciudad).",
    en: "Add a single <h1> at the top that says what the page is about (service + city).",
  },
  "images-no-alt": {
    es: 'Agrega un atributo alt corto y descriptivo a cada <img> (qué muestra la foto). Las imágenes decorativas llevan alt="".',
    en: 'Add a short, descriptive alt attribute to every <img> (what the photo shows). Decorative images get alt="".',
  },
  "slow-page": {
    es: "Estas páginas tardaron más de 3 segundos en responder. Comprime y redimensiona las fotos (WebP, tamaño real, carga diferida abajo de la pantalla), quita scripts que no se usen y activa la caché.",
    en: "These pages took more than 3 seconds to respond. Compress and resize images (WebP, real display size, lazy-load below the fold), remove unused scripts and enable caching.",
  },
  "no-sitemap": {
    es: "Crea /sitemap.xml con todas las páginas públicas y ponlo en robots.txt (Sitemap: <dirección del sitemap>).",
    en: "Create /sitemap.xml listing every public page and reference it in robots.txt (Sitemap: <sitemap URL>).",
  },
  "no-structured-data": {
    es: "Agrega datos estructurados LocalBusiness (JSON-LD) a la página de inicio: nombre, dirección, teléfono y horario. El dueño tiene el código listo en la sección «Código para Google» de su app; pídeselo si no te lo dio.",
    en: "Add LocalBusiness structured data (JSON-LD) to the home page: name, address, phone and hours. The owner has the code ready in the \"Code for Google\" section of their app; ask for it if they didn't give it to you.",
  },
  "title-too-short": {
    es: "Alarga el <title> a 30-60 caracteres agregando el servicio y la ciudad.",
    en: "Lengthen the <title> to 30-60 characters by adding the service and the city.",
  },
  "description-length": {
    es: "Reescribe la meta descripción para que tenga de 120 a 155 caracteres.",
    en: "Rewrite the meta description so it's 120-155 characters long.",
  },
  "multiple-h1": {
    es: "Deja un solo <h1> por página y convierte los demás en <h2>.",
    en: "Keep a single <h1> per page and turn the others into <h2>.",
  },
  "thin-content": {
    es: "Estas páginas tienen menos de 250 palabras. Agrega contenido útil: qué incluye el servicio, para quién es, zonas que atiende y preguntas frecuentes, usando solo datos que ya estén en el sitio.",
    en: "These pages have fewer than 250 words. Add useful content: what the service includes, who it's for, areas served and FAQs, using only facts already on the site.",
  },
  "no-og-image": {
    es: "Agrega las etiquetas og:image (y og:title, og:description) para que al compartir salga una foto. Usa una foto que ya esté en el sitio (1200×630).",
    en: "Add og:image (plus og:title and og:description) tags so shared links show a photo. Use a photo already on the site (1200×630).",
  },
  "missing-lang": {
    es: 'Pon el idioma en la etiqueta <html> (por ejemplo, lang="es").',
    en: 'Set the language on the <html> tag (for example, lang="en").',
  },
  "no-robots": {
    es: "Crea /robots.txt que permita leer el sitio y diga dónde está el sitemap.",
    en: "Create /robots.txt that allows crawling and points to the sitemap.",
  },
  // ---------- versión 2 ----------
  "robots-blocks-site": {
    es: "En /robots.txt hay un «Disallow: /» que aplica a todos (User-agent: *) o a Googlebot. Quítalo; deja solo los Disallow de rutas privadas (por ejemplo /admin/) y la línea Sitemap.",
    en: "/robots.txt has a \"Disallow: /\" that applies to everyone (User-agent: *) or to Googlebot. Remove it; keep only Disallow rules for private paths (e.g. /admin/) and the Sitemap line.",
  },
  "schema-invalid-json": {
    es: "El bloque <script type=\"application/ld+json\"> de estas páginas no es JSON válido (coma de más, comillas sin cerrar, comentarios). Corrígelo y valida con https://search.google.com/test/rich-results.",
    en: "The <script type=\"application/ld+json\"> block on these pages isn't valid JSON (trailing comma, unclosed quotes, comments). Fix it and validate with https://search.google.com/test/rich-results.",
  },
  "mixed-content": {
    es: "Cambia a https:// cada recurso (img, script, link rel=stylesheet, iframe, source) que hoy se carga con http://, o usa rutas relativas. Las direcciones exactas están abajo.",
    en: "Change every resource (img, script, link rel=stylesheet, iframe, source) loaded over http:// to https://, or use relative paths. The exact addresses are below.",
  },
  "www-mismatch": {
    es: "La versión con www y la versión sin www responden las dos con 200. Elige la versión principal (la del canonical) y agrega una redirección 301 de la otra hacia ella, en el hosting o en la configuración del dominio.",
    en: "Both the www and the non-www versions answer with 200. Choose the main version (the canonical one) and add a 301 redirect from the other one, in the hosting or domain settings.",
  },
  "wp-junk-urls": {
    es: "Estas direcciones del WordPress viejo (/author/, /category/, /tag/, /uncategorized/, /AAAA/MM/, ?p=, /feed/, attachment) todavía responden o están en el sitemap. Agrega redirecciones 301 a la página nueva equivalente (o responde 410 si no hay equivalente), quítalas del sitemap y de los enlaces internos.",
    en: "These old WordPress addresses (/author/, /category/, /tag/, /uncategorized/, /YYYY/MM/, ?p=, /feed/, attachment) still respond or are in the sitemap. Add 301 redirects to the equivalent new page (or return 410 when there's none), and remove them from the sitemap and internal links.",
  },
  "sitemap-bad-urls": {
    es: "Quita del sitemap las direcciones que dan error, redirigen o tienen noindex. Deja solo las direcciones finales (la del canonical) que responden 200.",
    en: "Remove from the sitemap every URL that errors, redirects or is noindex. Keep only final (canonical) URLs that answer 200.",
  },
  "schema-wrong-property": {
    es: "En el JSON-LD hay propiedades que no existen para ese tipo en schema.org. Muévelas a donde corresponden: availableLanguage va dentro de contactPoint ({\"@type\":\"ContactPoint\",\"contactType\":\"customer service\",\"telephone\":\"…\",\"availableLanguage\":[\"English\",\"Spanish\"]}); los campos de dirección van dentro de address (PostalAddress); opens/closes/dayOfWeek van dentro de openingHoursSpecification; ratingValue/reviewCount dentro de aggregateRating. Valida con https://validator.schema.org.",
    en: "The JSON-LD has properties that don't exist for that schema.org type. Move them where they belong: availableLanguage goes inside contactPoint ({\"@type\":\"ContactPoint\",\"contactType\":\"customer service\",\"telephone\":\"…\",\"availableLanguage\":[\"English\",\"Spanish\"]}); address fields go inside address (PostalAddress); opens/closes/dayOfWeek go inside openingHoursSpecification; ratingValue/reviewCount inside aggregateRating. Validate with https://validator.schema.org.",
  },
  "schema-business-incomplete": {
    es: "Completa el LocalBusiness con name, address (PostalAddress con streetAddress, addressLocality, addressRegion, postalCode, addressCountry), telephone y url, usando solo los datos que ya están en el sitio o en el Perfil de Google.",
    en: "Complete the LocalBusiness with name, address (PostalAddress with streetAddress, addressLocality, addressRegion, postalCode, addressCountry), telephone and url, using only data already on the site or the Google Business Profile.",
  },
  "schema-opening-hours": {
    es: "Corrige el horario: openingHours como \"Mo-Fr 09:00-18:00\" (días Mo Tu We Th Fr Sa Su, horas HH:MM de 24 horas), u openingHoursSpecification con dayOfWeek en inglés (Monday…Sunday) y opens/closes en HH:MM.",
    en: "Fix the hours: openingHours like \"Mo-Fr 09:00-18:00\" (days Mo Tu We Th Fr Sa Su, 24-hour HH:MM), or openingHoursSpecification with English dayOfWeek (Monday…Sunday) and opens/closes as HH:MM.",
  },
  "ai-search-bots-blocked": {
    es: "En /robots.txt permite a los robots de búsqueda con IA que están bloqueados (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User, ClaudeBot): quita su «Disallow: /» o agrega un grupo con «User-agent: <robot>» y «Allow: /».",
    en: "In /robots.txt allow the blocked AI search bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-User, ClaudeBot): remove their \"Disallow: /\" or add a group with \"User-agent: <bot>\" and \"Allow: /\".",
  },
  "duplicate-content": {
    es: "Estas páginas tienen el mismo texto visible. Escribe contenido propio para cada una o deja una y pon en las otras una redirección 301 o un <link rel=\"canonical\"> hacia ella.",
    en: "These pages have the same visible text. Write unique content for each, or keep one and point the others to it with a 301 redirect or <link rel=\"canonical\">.",
  },
  "broken-images": {
    es: "Estas imágenes responden con error. Vuelve a subir el archivo o corrige la dirección en el src (y srcset); si ya no sirve, quita la etiqueta <img>.",
    en: "These images return an error. Re-upload the file or fix the address in src (and srcset); if it's no longer needed, remove the <img> tag.",
  },
  "wp-com-links": {
    es: "Hay enlaces e imágenes que apuntan a wp.com / wordpress.com (por ejemplo i0.wp.com). Descarga esas imágenes y súbelas al sitio actual, cambia los src a la dirección propia y quita o reemplaza los enlaces a wordpress.com.",
    en: "There are links and images pointing to wp.com / wordpress.com (e.g. i0.wp.com). Download those images and host them on the current site, change the src to the site's own address and remove or replace links to wordpress.com.",
  },
  "hreflang-missing": {
    es: "Agrega en el <head> de cada página <link rel=\"alternate\" hreflang=\"es\" href=\"…\"> y hreflang=\"en\" (más x-default) apuntando a la versión en cada idioma, o ponlos en el sitemap con xhtml:link.",
    en: "Add <link rel=\"alternate\" hreflang=\"es\" href=\"…\"> and hreflang=\"en\" (plus x-default) in each page's <head>, pointing to each language version, or put them in the sitemap with xhtml:link.",
  },
  "orphan-pages": {
    es: "Ninguna página leída enlaza a estas. Agrega enlaces internos con texto descriptivo desde el menú, el pie o páginas relacionadas (o quítalas del sitemap si ya no sirven).",
    en: "No page we read links to these. Add internal links with descriptive anchor text from the menu, the footer or related pages (or remove them from the sitemap if they're no longer needed).",
  },
  "deep-pages": {
    es: "Estas páginas están a más de 3 clics del inicio. Enlázalas desde el menú, el pie o una página de servicios para que queden a 3 clics o menos.",
    en: "These pages are more than 3 clicks from the home page. Link to them from the menu, the footer or a services page so they're 3 clicks away or less.",
  },
  "single-inlink": {
    es: "Solo una página enlaza a cada una de estas. Agrega 2 o 3 enlaces internos más desde páginas relacionadas, con texto que describa la página.",
    en: "Only one page links to each of these. Add 2 or 3 more internal links from related pages, with anchor text that describes the page.",
  },
  "ai-training-bots-blocked": {
    es: "Si el dueño quiere que las IAs conozcan el negocio, en /robots.txt quita el «Disallow: /» de GPTBot, Google-Extended, Applebot-Extended o ClaudeBot. Si lo bloqueó a propósito, déjalo así.",
    en: "If the owner wants AIs to know the business, remove the \"Disallow: /\" for GPTBot, Google-Extended, Applebot-Extended or ClaudeBot in /robots.txt. If it was blocked on purpose, leave it.",
  },
  "llms-txt-missing": {
    es: "Crea /llms.txt (texto plano, Markdown) según https://llmstxt.org: «# Nombre del negocio», una línea «> qué hace y dónde», y secciones «## Servicios», «## Contacto» con listas «- [Página](https://…): una frase». Usa solo datos que ya están en el sitio.",
    en: "Create /llms.txt (plain-text Markdown) following https://llmstxt.org: \"# Business name\", a \"> what it does and where\" line, and \"## Services\", \"## Contact\" sections with \"- [Page](https://…): one sentence\" lists. Use only facts already on the site.",
  },
  "llms-txt-invalid": {
    es: "Corrige /llms.txt según https://llmstxt.org: que responda texto plano (no HTML), que la primera línea sea «# Nombre», luego «> resumen» y listas de enlaces Markdown «- [Página](https://…)».",
    en: "Fix /llms.txt following https://llmstxt.org: it must return plain text (not HTML), the first line must be \"# Name\", then a \"> summary\" line and Markdown link lists \"- [Page](https://…)\".",
  },
  "long-paragraphs": {
    es: "Divide los párrafos de más de 150 palabras en párrafos de 40 a 80 palabras, con subtítulos <h2>/<h3> y listas. No cambies el sentido ni agregues datos.",
    en: "Split paragraphs over 150 words into 40-80 word paragraphs, with <h2>/<h3> subheadings and lists. Don't change the meaning or add facts.",
  },
  "weak-semantic-html": {
    es: "Envuelve el contenido principal en <main> (y artículos en <article>) y usa <h2> para cada sección. No cambies el diseño.",
    en: "Wrap the main content in <main> (and articles in <article>) and use <h2> for each section. Don't change the design.",
  },
  "schema-org-incomplete": {
    es: "Completa el JSON-LD: Organization con name, url y logo; WebSite con name y url.",
    en: "Complete the JSON-LD: Organization with name, url and logo; WebSite with name and url.",
  },
  "h1-same-as-title": {
    es: "Haz que el <h1> no sea idéntico al <title>: mantén el tema y la ciudad, pero cambia el orden o agrega una variante (por ejemplo, título «Reparación de techos en Miami | Marca» y H1 «Reparamos tu techo en Miami y Hialeah»).",
    en: "Make the <h1> different from the <title>: keep the topic and city but change the order or add a variant (e.g. title \"Roof Repair in Miami | Brand\" and H1 \"We Repair Roofs in Miami and Hialeah\").",
  },
  "low-text-ratio": {
    es: "El texto visible es menos del 10% del HTML. Quita scripts, estilos en línea y código que no se usa, o agrega contenido útil con datos que ya estén en el sitio.",
    en: "Visible text is under 10% of the HTML. Remove unused scripts, inline styles and dead code, or add useful content using facts already on the site.",
  },
  "too-many-links": {
    es: "Estas páginas tienen más de 250 enlaces. Reduce menús y listas repetidas; deja los enlaces más útiles.",
    en: "These pages have more than 250 links. Trim repeated menus and lists; keep the most useful links.",
  },
  "large-html": {
    es: "El HTML de estas páginas pesa más de 2 MB. Quita datos incrustados grandes (JSON, SVG o imágenes en base64) y código que no se usa.",
    en: "These pages' HTML is over 2 MB. Remove large inline data (JSON, SVG or base64 images) and unused code.",
  },
};
