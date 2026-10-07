import Link from "next/link";
import { AiPromptButton } from "@/components/seo/AiPromptButton";
import { HowToRead } from "@/components/seo/HowToRead";
import styles from "@/components/seo/SeoHelp.module.css";
import { getT } from "@/lib/i18n-server";
import { loadPlainSummary, topLines } from "@/lib/seo/plain-load";
import { loadGeneralPrompt } from "@/lib/seo/prompts-load";

/** Una palabra del glosario: qué es, un ejemplo y cuándo está bien o mal. */
type Term = { term: string; what: string; example: string; good: string; bad: string };

/**
 * Arriba de la página de SEO: un resumen en palabras simples armado con los últimos reportes guardados (sin IA,
 * sin costo), qué quiere decir cada número de la página y el prompt general para la IA de la página web.
 */
export async function SeoGuide({ businessId }: { businessId: string }) {
  const { lang, t } = await getT();
  // Las mismas lecturas que la tarjeta "Tu SEO esta semana" de Inicio (plain-load.ts), para que digan lo mismo.
  const data = await loadPlainSummary(businessId);
  if (!data) return null;
  const lines = data.lines;
  const pick = (x: { es: string; en: string }) => (lang === "en" ? x.en : x.es);
  // El prompt general: lo más importante de todos los reportes guardados, con el resumen de arriba como contexto.
  const general = await loadGeneralPrompt(businessId, lang, topLines(lines, 8).map((l) => pick(l.text)));

  // Un ejemplo con una búsqueda del negocio, para que se entienda con algo suyo.
  const kw = data.tracked[0] ?? t("lo que vendes + tu ciudad", "what you sell + your city");
  const glossary: Term[] = [
    {
      term: t("Posición en Google", "Position on Google"),
      what: t("El lugar donde sale tu página cuando alguien busca algo. 1 = el primero de la lista.", "The spot where your website shows up when someone searches. 1 = first on the list."),
      example: t(`si buscan «${kw}» y tu página sale tercera, tu posición es 3.`, `if people search “${kw}” and your website is third, your position is 3.`),
      good: t("1 a 3: excelente, ahí van casi todos los clics. 4 a 10: bien, estás en la primera página.", "1 to 3: excellent, almost all clicks go there. 4 to 10: good, you're on page one."),
      bad: t("11 a 20: segunda página, casi nadie llega. «No sales»: no estás ni en los primeros 20.", "11 to 20: page two, almost nobody gets there. “Not showing”: you're not even in the top 20."),
    },
    {
      term: t("Mapa de Google (los 3 del mapa)", "Google's map (the map's top 3)"),
      what: t("En búsquedas locales Google pone arriba de todo un mapa con solo 3 negocios. De ahí la gente te llama o pide cómo llegar.", "On local searches Google puts a map with just 3 businesses above everything. People call you or get directions straight from there."),
      example: t("«📍 2° en el mapa» = eres el segundo de esos 3.", "“📍 #2 on the map” = you're the second of those 3."),
      good: t("Salir 1°, 2° o 3°. Depende de tu Perfil de Google y tus reseñas, no de tu página web.", "Being #1, #2 or #3. It depends on your Google profile and reviews, not your website."),
      bad: t("«Hay mapa, pero no sales». («Google no mostró mapa» no es un problema: esa búsqueda no tiene mapa.)", "“There's a map, but you're not on it”. (“Google showed no map” isn't a problem: that search has no map.)"),
    },
    {
      term: t("Búsquedas al mes", "Monthly searches"),
      what: t("Cuántas veces escriben esa frase en Google en un mes, en tu zona (promedio del último año).", "How many times that phrase is typed into Google in a month, in your area (last year's average)."),
      example: t("90 al mes = unas 3 personas al día buscando eso.", "90 a month = about 3 people a day searching for it."),
      good: t("Para un negocio local, 50 a 500 ya es muy bueno si la frase es justo lo que vendes.", "For a local business, 50 to 500 is already very good if the phrase is exactly what you sell."),
      bad: t("«—»: casi nadie la busca (menos de unas 10 al mes) o Google no tiene datos. Sigue también frases que sí se buscan.", "“—”: almost nobody searches it (fewer than about 10 a month) or Google has no data. Also track phrases people do search."),
    },
    {
      term: t("Visibilidad (0 a 100 %)", "Visibility (0 to 100%)"),
      what: t("Qué parte de los clics posibles de tus búsquedas te llegan, según el lugar donde sales. Salir arriba pesa mucho más.", "How much of the possible clicks on your searches reach you, based on where you rank. Ranking at the top weighs much more."),
      example: t("si sales 2° en todas tus búsquedas, tu visibilidad es 50 %; si sales 1° en todas, 100 %.", "if you're #2 on all your searches, your visibility is 50%; #1 on all of them, 100%."),
      good: t("50 % o más: excelente. 15 a 49 %: vas bien, ya te encuentran en varias.", "50% or more: excellent. 15 to 49%: doing well, people find you on several."),
      bad: t("Menos de 15 %: casi nadie te encuentra en Google todavía.", "Under 15%: almost nobody finds you on Google yet."),
    },
    {
      term: t("Nota de 0 a 100", "Score from 0 to 100"),
      what: t("La salud de tu página web (auditoría), de cada página comparada con las que ganan, o de tu Perfil de Google. Cada sección dice «¿Cómo se calcula?».", "The health of your website (audit), of each page compared with the winners, or of your Google profile. Each section has “How is it calculated?”."),
      example: t("94 de 100 en la auditoría = excelente, solo quedan detalles.", "94 out of 100 on the audit = excellent, only details left."),
      good: t("90 a 100: excelente. 70 a 89: bien.", "90 to 100: excellent. 70 to 89: good."),
      bad: t("50 a 69: regular. Menos de 50: urgente, arregla primero lo rojo.", "50 to 69: fair. Under 50: urgent, fix the red items first."),
    },
    {
      term: t("Dificultad (0 a 100)", "Difficulty (0 to 100)"),
      what: t("Qué tan difícil es llegar gratis a la primera página de Google con esa búsqueda.", "How hard it is to reach Google's first page for free with that search."),
      example: t("dificultad 12 = fácil: con una buena página o artículo puedes llegar.", "difficulty 12 = easy: a good page or article can get you there."),
      good: t("0 a 29: fácil, empieza por estas.", "0 to 29: easy, start with these."),
      bad: t("60 o más: difícil, toma meses y muchos enlaces.", "60 or more: hard, it takes months and many links."),
    },
    {
      term: t("Competencia en anuncios y CPC", "Ad competition and CPC"),
      what: t("Cuántos negocios pagan anuncios en Google por esa búsqueda (baja, media, alta) y cuánto paga cada uno por clic (CPC). No dice qué tan difícil es salir gratis.", "How many businesses pay for Google ads on that search (low, medium, high) and what each pays per click (CPC). It doesn't say how hard it is to show up for free."),
      example: t("CPC de US$1,50 = cada visita por anuncio le cuesta eso a tu competencia.", "A US$1.50 CPC = each ad visit costs your competitor that much."),
      good: t("Alta o CPC alto: esa búsqueda trae clientes que valen dinero. Salir gratis ahí vale mucho.", "High, or a high CPC: that search brings customers worth money. Showing up for free there is worth a lot."),
      bad: t("Baja: pocos pagan por ella; puede traer curiosos más que clientes.", "Low: few pay for it; it may bring browsers more than customers."),
    },
  ];

  return (
    <section className="card" id="resumen">
      <div className="stack" style={{ gap: 4 }}>
        <h2>{t("Tu resumen en palabras simples", "Your summary in plain words")}</h2>
        <p className="small muted">
          {t(
            "Lo armamos con tus últimas revisiones guardadas: qué va bien, qué urge y qué hacer. No usa IA ni cuesta nada.",
            "Built from your latest saved checks: what's going well, what's urgent and what to do. It uses no AI and costs nothing.",
          )}
        </p>
      </div>

      {lines.length > 0 ? (
        <ul className={styles.lines}>
          {lines.map((l) => (
            <li key={l.id} className={`${styles.line} ${styles[l.tone]}`}>
              <span className={styles.icon} aria-hidden="true">{l.icon}</span>
              <span className={styles.text}>
                {pick(l.text)}{" "}
                {l.action && (
                  <>
                    <Link href={l.action.href}>{pick(l.action.label)} →</Link>
                    {" · "}
                  </>
                )}
                <a href={l.link.href}>{pick(l.link.label)} ↓</a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">
          {t(
            "Todavía no hay datos para resumir. Empieza por elegir tu zona y tus palabras clave en la pestaña «⚙ Ajustes».",
            "There's no data to summarize yet. Start by picking your area and keywords in the “⚙ Settings” tab.",
          )}
        </p>
      )}

      <HowToRead title={t("¿Cómo leer esta página?", "How to read this page?")}>
        <dl className={styles.glossary}>
          {glossary.map((g) => (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>
                <span>{g.what}</span>
                <span className={styles.example}>
                  <strong>{t("Ejemplo: ", "Example: ")}</strong>
                  {g.example}
                </span>
                <span className={styles.good}>
                  <span aria-hidden="true">✓ </span>
                  <strong>{t("Bien: ", "Good: ")}</strong>
                  {g.good}
                </span>
                <span className={styles.bad}>
                  <span aria-hidden="true">✗ </span>
                  <strong>{t("Mal: ", "Bad: ")}</strong>
                  {g.bad}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </HowToRead>
      <p className="small muted" style={{ margin: 0 }}>
        {t(
          "¿Por dónde empiezo? Por lo marcado en rojo arriba. Cada sección termina con un botón para copiar instrucciones para la IA de tu web.",
          "Where do I start? With whatever is marked red above. Each section ends with a button to copy instructions for your website's AI.",
        )}
      </p>
      <AiPromptButton
        text={general}
        label={t("Copiar el prompt general para la IA de tu web", "Copy the general prompt for your website's AI")}
        hint={t(
          "Junta lo más importante de todas las secciones (auditoría, páginas, preguntas, competencia…) en un solo texto para la IA que maneja tu página.",
          "Puts the most important items from every section (audit, pages, questions, competitors…) into one text for the AI that manages your website.",
        )}
      />
    </section>
  );
}
