import { DEFAULT_PAGE_SETUP } from './page-setup'
import type { DraftDocument, DraftNode } from './document-model'
import { defaultStyles, type DocumentStyle } from './styles'
import type { Locale } from '../types'

export const starterTemplateIds = ['cv', 'letter', 'report', 'meeting-notes', 'essay'] as const
export type StarterTemplateId = (typeof starterTemplateIds)[number]

type TemplateCopy = {
  label: string
  description: string
  fileName: string
  title: string
  subtitle: string
  sections: Record<string, string>
  lines: Record<string, string[]>
}

const copy: Record<Locale, Record<StarterTemplateId, TemplateCopy>> = {
  en: {
    cv: {
      label: 'CV',
      description: 'A clear profile with space for experience, education, and skills.',
      fileName: 'CV',
      title: 'Name Surname',
      subtitle: 'Role or professional focus',
      sections: { profile: 'Profile', experience: 'Experience', education: 'Education', skills: 'Skills' },
      lines: {
        contact: ['email@example.com · City · +00 000 000 000'],
        profile: ['Write a short introduction that connects your experience and strengths to the role.'],
        experience: ['Role · Organization · YYYY–present', 'Describe a result, contribution, or area of ownership.'],
        education: ['Qualification · Institution · Year'],
        skills: ['Skill or tool', 'Language · proficiency'],
      },
    },
    letter: {
      label: 'Letter',
      description: 'A composed page for a personal or professional letter.',
      fileName: 'Letter',
      title: 'Letter',
      subtitle: 'Your name · Email · City',
      sections: { recipient: 'Recipient', body: 'Message' },
      lines: {
        date: ['City, date'],
        recipient: ['Recipient name', 'Organization', 'Street address'],
        greeting: ['Dear recipient,'],
        body: [
          'Open with your reason for writing.',
          'Add the details the reader needs, then state any next step clearly.',
        ],
        closing: ['Kind regards,', 'Your name'],
      },
    },
    report: {
      label: 'Report',
      description: 'A structured brief with summary, findings, and next steps.',
      fileName: 'Report',
      title: 'Report title',
      subtitle: 'Subject or reporting period',
      sections: { summary: 'Summary', findings: 'Findings', next: 'Next steps' },
      lines: {
        byline: ['Prepared by · Date'],
        summary: ['State the purpose, key result, and most important context in a few sentences.'],
        findings: ['Finding or observation one', 'Finding or observation two'],
        next: ['Action · Owner · Target date', 'Action · Owner · Target date'],
      },
    },
    'meeting-notes': {
      label: 'Meeting notes',
      description: 'A practical record of attendees, agenda, discussion, and actions.',
      fileName: 'Meeting notes',
      title: 'Meeting notes',
      subtitle: 'Team or project · Date · Location',
      sections: { attendees: 'Attendees', agenda: 'Agenda', discussion: 'Discussion', actions: 'Actions' },
      lines: {
        attendees: ['Name · Name · Name'],
        agenda: ['Topic one', 'Topic two', 'Topic three'],
        discussion: ['Capture decisions, context, and open questions.'],
        actions: ['Action · Owner · Due date', 'Action · Owner · Due date'],
      },
    },
    essay: {
      label: 'Essay',
      description: 'A calm reading layout for an introduction, argument, and conclusion.',
      fileName: 'Essay',
      title: 'Essay title',
      subtitle: 'Course · Your name · Date',
      sections: { introduction: 'Introduction', argument: 'Argument', conclusion: 'Conclusion' },
      lines: {
        introduction: ['Introduce the question, give the reader context, and state your central claim.'],
        argument: [
          'Present one supporting point and explain the evidence behind it.',
          'Connect this point to your central claim.',
        ],
        conclusion: ['Bring the main points together and explain why the argument matters.'],
      },
    },
  },
  pl: {
    cv: {
      label: 'CV',
      description: 'Czytelny profil z miejscem na doświadczenie, wykształcenie i umiejętności.',
      fileName: 'CV',
      title: 'Imię i nazwisko',
      subtitle: 'Stanowisko lub obszar zawodowy',
      sections: { profile: 'Profil', experience: 'Doświadczenie', education: 'Wykształcenie', skills: 'Umiejętności' },
      lines: {
        contact: ['email@example.com · Miasto · +00 000 000 000'],
        profile: ['Krótko opisz doświadczenie i mocne strony przydatne na wybranym stanowisku.'],
        experience: ['Stanowisko · Organizacja · RRRR–obecnie', 'Opisz rezultat, wkład lub obszar odpowiedzialności.'],
        education: ['Kwalifikacja · Uczelnia lub szkoła · Rok'],
        skills: ['Umiejętność lub narzędzie', 'Język · poziom'],
      },
    },
    letter: {
      label: 'List',
      description: 'Przejrzysta strona do listu prywatnego lub zawodowego.',
      fileName: 'List',
      title: 'List',
      subtitle: 'Imię i nazwisko · E-mail · Miasto',
      sections: { recipient: 'Adresat', body: 'Treść' },
      lines: {
        date: ['Miasto, data'],
        recipient: ['Imię i nazwisko adresata', 'Organizacja', 'Ulica i numer'],
        greeting: ['Szanowna Pani / Szanowny Panie,'],
        body: ['Na początku wyjaśnij powód napisania.', 'Dodaj potrzebne szczegóły i jasno opisz kolejny krok.'],
        closing: ['Z poważaniem,', 'Imię i nazwisko'],
      },
    },
    report: {
      label: 'Raport',
      description: 'Uporządkowany dokument z podsumowaniem, ustaleniami i dalszymi krokami.',
      fileName: 'Raport',
      title: 'Tytuł raportu',
      subtitle: 'Temat lub okres sprawozdawczy',
      sections: { summary: 'Podsumowanie', findings: 'Ustalenia', next: 'Dalsze kroki' },
      lines: {
        byline: ['Autor · Data'],
        summary: ['W kilku zdaniach podaj cel, najważniejszy wynik i potrzebny kontekst.'],
        findings: ['Ustalenie lub obserwacja pierwsza', 'Ustalenie lub obserwacja druga'],
        next: ['Działanie · Osoba odpowiedzialna · Termin', 'Działanie · Osoba odpowiedzialna · Termin'],
      },
    },
    'meeting-notes': {
      label: 'Notatki ze spotkania',
      description: 'Praktyczny zapis uczestników, agendy, dyskusji i działań.',
      fileName: 'Notatki ze spotkania',
      title: 'Notatki ze spotkania',
      subtitle: 'Zespół lub projekt · Data · Miejsce',
      sections: { attendees: 'Uczestnicy', agenda: 'Agenda', discussion: 'Dyskusja', actions: 'Działania' },
      lines: {
        attendees: ['Imię i nazwisko · Imię i nazwisko · Imię i nazwisko'],
        agenda: ['Temat pierwszy', 'Temat drugi', 'Temat trzeci'],
        discussion: ['Zapisz decyzje, kontekst i pytania bez odpowiedzi.'],
        actions: ['Działanie · Osoba odpowiedzialna · Termin', 'Działanie · Osoba odpowiedzialna · Termin'],
      },
    },
    essay: {
      label: 'Esej',
      description: 'Spokojny układ do wstępu, argumentacji i zakończenia.',
      fileName: 'Esej',
      title: 'Tytuł eseju',
      subtitle: 'Kurs · Imię i nazwisko · Data',
      sections: { introduction: 'Wstęp', argument: 'Argumentacja', conclusion: 'Zakończenie' },
      lines: {
        introduction: ['Przedstaw pytanie, podaj kontekst i sformułuj główną tezę.'],
        argument: ['Podaj argument i wyjaśnij, jakie dowody go wspierają.', 'Powiąż ten punkt z główną tezą.'],
        conclusion: ['Zbierz najważniejsze punkty i wyjaśnij, dlaczego argument ma znaczenie.'],
      },
    },
  },
}

const palette: Record<StarterTemplateId, { heading: string; title: string; body: string; align?: 'left' | 'center' }> =
  {
    cv: { heading: '#245764', title: '#173d49', body: 'Arimo' },
    letter: { heading: '#52634a', title: '#394735', body: 'Carlito' },
    report: { heading: '#68503c', title: '#493424', body: 'Arimo' },
    'meeting-notes': { heading: '#3f5b73', title: '#2c4257', body: 'Carlito' },
    essay: { heading: '#624755', title: '#49333f', body: 'Tinos', align: 'center' },
  }

function styledDefinitions(id: StarterTemplateId): DocumentStyle[] {
  const theme = palette[id]
  const overrides: Record<string, Partial<DocumentStyle['format']>> = {
    Normal: { fontFamily: theme.body, fontSize: id === 'essay' ? 12 : 11, spacingAfter: 8, lineSpacing: 1.45 },
    Title: {
      fontFamily: theme.body,
      fontSize: id === 'cv' ? 28 : 26,
      color: theme.title,
      bold: true,
      textAlign: theme.align,
      spacingAfter: 6,
      lineSpacing: 1.15,
    },
    Subtitle: {
      fontFamily: theme.body,
      fontSize: 12,
      color: theme.heading,
      textAlign: theme.align,
      spacingAfter: 18,
    },
    Heading1: {
      fontFamily: theme.body,
      fontSize: 16,
      color: theme.heading,
      bold: true,
      spacingBefore: 14,
      spacingAfter: 5,
    },
    Heading2: {
      fontFamily: theme.body,
      fontSize: 13,
      color: theme.heading,
      bold: true,
      spacingBefore: 10,
      spacingAfter: 4,
    },
    ListParagraph: { fontFamily: theme.body, fontSize: id === 'essay' ? 12 : 11, spacingAfter: 3, lineSpacing: 1.35 },
    Quote: { color: theme.heading, italic: true, indentLeft: 18, indentRight: 18, spacingBefore: 8 },
  }
  return defaultStyles.map((style) => ({
    ...style,
    format: { ...style.format, ...overrides[style.id] },
  }))
}

function paragraph(text: string, styleId = 'Normal', type: 'paragraph' | 'heading' = 'paragraph'): DraftNode {
  const headingLevel = type === 'heading' ? Number(styleId.replace('Heading', '')) || 1 : undefined
  return {
    type,
    attrs: { styleId, ...(headingLevel ? { level: headingLevel } : {}) },
    content: [{ type: 'text', text }],
  }
}

function heading(text: string): DraftNode {
  return paragraph(text, 'Heading1', 'heading')
}

function bulletList(lines: string[]): DraftNode {
  return {
    type: 'bulletList',
    content: lines.map((line) => ({ type: 'listItem', content: [paragraph(line, 'ListParagraph')] })),
  }
}

function orderedList(lines: string[]): DraftNode {
  return {
    type: 'orderedList',
    content: lines.map((line) => ({ type: 'listItem', content: [paragraph(line, 'ListParagraph')] })),
  }
}

function templateContent(id: StarterTemplateId, text: TemplateCopy): DraftNode[] {
  const p = (key: string) => (text.lines[key] || []).map((line) => paragraph(line))
  switch (id) {
    case 'cv':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        ...p('contact'),
        heading(text.sections.profile),
        ...p('profile'),
        heading(text.sections.experience),
        bulletList(text.lines.experience),
        heading(text.sections.education),
        bulletList(text.lines.education),
        heading(text.sections.skills),
        bulletList(text.lines.skills),
      ]
    case 'letter':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        ...p('date'),
        heading(text.sections.recipient),
        ...p('recipient'),
        ...p('greeting'),
        heading(text.sections.body),
        ...p('body'),
        ...p('closing'),
      ]
    case 'report':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        ...p('byline'),
        heading(text.sections.summary),
        ...p('summary'),
        heading(text.sections.findings),
        bulletList(text.lines.findings),
        heading(text.sections.next),
        orderedList(text.lines.next),
      ]
    case 'meeting-notes':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        heading(text.sections.attendees),
        ...p('attendees'),
        heading(text.sections.agenda),
        orderedList(text.lines.agenda),
        heading(text.sections.discussion),
        ...p('discussion'),
        heading(text.sections.actions),
        bulletList(text.lines.actions),
      ]
    case 'essay':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        heading(text.sections.introduction),
        ...p('introduction'),
        heading(text.sections.argument),
        ...p('argument'),
        paragraph(text.lines.argument[0], 'Quote'),
        heading(text.sections.conclusion),
        ...p('conclusion'),
      ]
  }
}

export type StarterTemplate = {
  id: StarterTemplateId
  label: string
  description: string
  fileName: string
  document: DraftDocument
}

export function getStarterTemplates(locale: Locale): StarterTemplate[] {
  return starterTemplateIds.map((id) => {
    const text = copy[locale][id]
    return {
      id,
      label: text.label,
      description: text.description,
      fileName: text.fileName,
      document: {
        type: 'doc',
        attrs: {
          columns: 1,
          pageSetup: JSON.stringify(DEFAULT_PAGE_SETUP),
          styleDefinitions: JSON.stringify(styledDefinitions(id)),
        },
        content: templateContent(id, text),
      },
    }
  })
}

export function createStarterTemplate(id: StarterTemplateId, locale: Locale): StarterTemplate {
  return getStarterTemplates(locale).find((template) => template.id === id)!
}
