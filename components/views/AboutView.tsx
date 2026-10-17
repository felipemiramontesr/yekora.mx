import { Award, ShieldCheck, Sparkles, Trees, Users } from 'lucide-react';
import { getMessages, type Locale } from '@/app/i18n';

/**
 * Icon of each brand value, in the order of `about.values` in both dictionaries:
 * accessibility, trust, love of nature, support for Mexican brands, learning and community.
 * AboutView.test.tsx fails if a dictionary adds or removes a value without updating this list.
 */
const VALUE_ICONS = [ShieldCheck, Award, Trees, Sparkles, Users] as const;

/**
 * "About us" page body, shared by `/nosotros/` and `/en/about/`: who YĒKORA is, purpose,
 * mission, vision, the five brand values, the promise and the brand personality.
 *
 * @param locale - Language of the page; picks the dictionary.
 */
export function AboutView({ locale }: Readonly<{ locale: Locale }>) {
  const { about } = getMessages(locale);
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{about.title}</h1>
      <p className="mt-6 text-xl leading-relaxed">{about.lede}</p>

      {about.sections.map((section) => (
        <section key={section.title} className="mt-12">
          <h2 className="text-2xl font-semibold">{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">{about.valuesTitle}</h2>
        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          {about.values.map((value, index) => {
            const Icon = VALUE_ICONS[index];
            return (
              <div key={value.title} className="border-t-2 border-ocre pt-3">
                <dt className="flex items-center gap-3 font-semibold">
                  <Icon aria-hidden="true" size={22} className="shrink-0" />
                  {value.title}
                </dt>
                <dd className="mt-2 text-petroleo/80">{value.text}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="mt-12 rounded-xl bg-petroleo p-8 text-marfil">
        <h2 className="text-2xl font-semibold">{about.promiseTitle}</h2>
        <p className="mt-3 leading-relaxed text-marfil/90">{about.promise}</p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">{about.personalityTitle}</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6">
          {about.personality.map((trait) => (
            <li key={trait}>{trait}</li>
          ))}
        </ul>
      </section>

      <p className="mt-12 border-l-4 border-ocre pl-4 text-lg font-semibold">
        {about.closing}
      </p>
    </article>
  );
}
