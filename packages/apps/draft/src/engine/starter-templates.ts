import { DEFAULT_PAGE_SETUP } from './page-setup'
import type { DraftDocument, DraftNode } from './document-model'
import { defaultStyles, type DocumentStyle } from './styles'
import type { Locale } from '../types'

export const starterTemplateIds = [
  'cv',
  'cv-modern',
  'cv-academic',
  'cover-letter',
  'letter',
  'report',
  'project-plan',
  'meeting-notes',
  'essay',
] as const
export type StarterTemplateId = (typeof starterTemplateIds)[number]
export type StarterTemplateCategory = 'cv' | 'work' | 'academic'

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
      label: 'Classic CV',
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
    'cv-modern': {
      label: 'Modern CV',
      description: 'A concise, contemporary profile with a strong skills section.',
      fileName: 'Modern CV',
      title: 'Name Surname',
      subtitle: 'Role · City · Email · Phone',
      sections: { profile: 'Profile', experience: 'Experience', projects: 'Selected projects', education: 'Education', skills: 'Skills' },
      lines: {
        profile: ['Summarize your strengths and the value you bring in two or three lines.'],
        experience: ['Role · Organization · YYYY–present', 'Describe an outcome with a clear result or measure.'],
        projects: ['Project · Your contribution · Result'],
        education: ['Qualification · Institution · Year'],
        skills: ['Core skill · Core skill · Tool · Language'],
      },
    },
    'cv-academic': {
      label: 'Academic CV',
      description: 'A structured academic profile for research, teaching, and publications.',
      fileName: 'Academic CV',
      title: 'Name Surname',
      subtitle: 'Discipline · Institution · Email',
      sections: { profile: 'Research profile', education: 'Education', research: 'Research experience', teaching: 'Teaching', publications: 'Selected publications', awards: 'Awards and grants' },
      lines: {
        profile: ['Describe your research interests and academic focus.'],
        education: ['Degree · Institution · Dissertation or thesis · Year'],
        research: ['Position · Institution · Dates', 'Summarize methods, contributions, and outcomes.'],
        teaching: ['Course · Institution · Role · Year'],
        publications: ['Author · Title · Journal or publisher · Year'],
        awards: ['Award or grant · Organization · Year'],
      },
    },
    'cover-letter': {
      label: 'Cover letter',
      description: 'A focused application letter that connects your experience to a role.',
      fileName: 'Cover letter',
      title: 'Cover letter',
      subtitle: 'Your name · Email · City',
      sections: { recipient: 'Hiring team', opening: 'Opening', fit: 'Why I am a fit', closing: 'Closing' },
      lines: {
        date: ['City, date'],
        recipient: ['Organization', 'Hiring manager'],
        greeting: ['Dear hiring manager,'],
        opening: ['Name the role and give a concise reason you are interested.'],
        fit: ['Connect one or two relevant achievements to what the role needs.'],
        closing: ['Thank you for your consideration.', 'Kind regards,', 'Your name'],
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
    'project-plan': {
      label: 'Project plan',
      description: 'Set out a project goal, scope, milestones, and next steps.',
      fileName: 'Project plan',
      title: 'Project plan',
      subtitle: 'Project · Owner · Date',
      sections: { objective: 'Objective', scope: 'Scope', milestones: 'Milestones', risks: 'Risks and dependencies', next: 'Next steps' },
      lines: {
        prepared: ['Prepared by · Date'],
        objective: ['State the outcome and how success will be measured.'],
        scope: ['Included work', 'Out of scope'],
        milestones: ['Milestone · Owner · Target date', 'Milestone · Owner · Target date'],
        risks: ['Risk or dependency · Response · Owner'],
        next: ['Action · Owner · Target date'],
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
      label: 'CV klasyczne',
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
    'cv-modern': {
      label: 'CV nowoczesne',
      description: 'Zwięzły, współczesny profil z wyraźną sekcją umiejętności.',
      fileName: 'CV nowoczesne',
      title: 'Imię i nazwisko',
      subtitle: 'Stanowisko · Miasto · E-mail · Telefon',
      sections: { profile: 'Profil', experience: 'Doświadczenie', projects: 'Wybrane projekty', education: 'Wykształcenie', skills: 'Umiejętności' },
      lines: {
        profile: ['W dwóch lub trzech zdaniach opisz swoje mocne strony i wartość, którą wnosisz.'],
        experience: ['Stanowisko · Organizacja · RRRR–obecnie', 'Opisz rezultat i podaj konkretny efekt.'],
        projects: ['Projekt · Twój wkład · Rezultat'],
        education: ['Kwalifikacja · Uczelnia lub szkoła · Rok'],
        skills: ['Umiejętność · Umiejętność · Narzędzie · Język'],
      },
    },
    'cv-academic': {
      label: 'CV akademickie',
      description: 'Układ dla osób z doświadczeniem badawczym, dydaktycznym i publikacjami.',
      fileName: 'CV akademickie',
      title: 'Imię i nazwisko',
      subtitle: 'Dziedzina · Uczelnia · E-mail',
      sections: { profile: 'Profil badawczy', education: 'Wykształcenie', research: 'Doświadczenie badawcze', teaching: 'Dydaktyka', publications: 'Wybrane publikacje', awards: 'Nagrody i granty' },
      lines: {
        profile: ['Opisz zainteresowania badawcze i obszar specjalizacji.'],
        education: ['Stopień · Uczelnia · Rozprawa lub praca · Rok'],
        research: ['Stanowisko · Uczelnia · Okres', 'Podsumuj metody, wkład i wyniki.'],
        teaching: ['Kurs · Uczelnia · Rola · Rok'],
        publications: ['Autor · Tytuł · Czasopismo lub wydawnictwo · Rok'],
        awards: ['Nagroda lub grant · Organizacja · Rok'],
      },
    },
    'cover-letter': {
      label: 'List motywacyjny',
      description: 'List, który łączy Twoje doświadczenie z wymaganiami stanowiska.',
      fileName: 'List motywacyjny',
      title: 'List motywacyjny',
      subtitle: 'Imię i nazwisko · E-mail · Miasto',
      sections: { recipient: 'Adresat', opening: 'Wstęp', fit: 'Dlaczego pasuję', closing: 'Zakończenie' },
      lines: {
        date: ['Miasto, data'],
        recipient: ['Organizacja', 'Osoba rekrutująca'],
        greeting: ['Szanowni Państwo,'],
        opening: ['Podaj nazwę stanowiska i krótko wyjaśnij, dlaczego Cię interesuje.'],
        fit: ['Połącz jedno lub dwa osiągnięcia z potrzebami opisanymi w ofercie.'],
        closing: ['Dziękuję za rozpatrzenie mojej kandydatury.', 'Z poważaniem,', 'Imię i nazwisko'],
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
    'project-plan': {
      label: 'Plan projektu',
      description: 'Zapisz cel projektu, jego zakres, etapy i dalsze działania.',
      fileName: 'Plan projektu',
      title: 'Plan projektu',
      subtitle: 'Projekt · Osoba odpowiedzialna · Data',
      sections: { objective: 'Cel', scope: 'Zakres', milestones: 'Etapy', risks: 'Ryzyka i zależności', next: 'Dalsze kroki' },
      lines: {
        prepared: ['Autor · Data'],
        objective: ['Opisz rezultat i sposób mierzenia powodzenia.'],
        scope: ['Prace w zakresie', 'Poza zakresem'],
        milestones: ['Etap · Osoba odpowiedzialna · Termin', 'Etap · Osoba odpowiedzialna · Termin'],
        risks: ['Ryzyko lub zależność · Reakcja · Osoba odpowiedzialna'],
        next: ['Działanie · Osoba odpowiedzialna · Termin'],
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

const palette: Record<StarterTemplateId, { heading: string; title: string; body: string; align?: 'left' | 'center' }> = {
  cv: { heading: '#245764', title: '#173d49', body: 'Arimo' },
  'cv-modern': { heading: '#5b4b8a', title: '#3c315f', body: 'Arimo' },
  'cv-academic': { heading: '#405d4a', title: '#2a4032', body: 'Carlito' },
  'cover-letter': { heading: '#6a4b37', title: '#493424', body: 'Carlito' },
  letter: { heading: '#52634a', title: '#394735', body: 'Carlito' },
  report: { heading: '#68503c', title: '#493424', body: 'Arimo' },
  'project-plan': { heading: '#3f5b73', title: '#2c4257', body: 'Arimo' },
  'meeting-notes': { heading: '#3f5b73', title: '#2c4257', body: 'Carlito' },
  essay: { heading: '#624755', title: '#49333f', body: 'Tinos', align: 'center' },
}

function styledDefinitions(id: StarterTemplateId): DocumentStyle[] {
  const theme = palette[id]
  const overrides: Record<string, Partial<DocumentStyle['format']>> = {
    Normal: { fontFamily: theme.body, fontSize: id === 'essay' ? 12 : 11, spacingAfter: 8, lineSpacing: 1.45 },
    Title: {
      fontFamily: theme.body,
      fontSize: id === 'cv' || id === 'cv-modern' ? 28 : 26,
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
    case 'cv-modern':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        heading(text.sections.profile),
        ...p('profile'),
        heading(text.sections.experience),
        bulletList(text.lines.experience),
        heading(text.sections.projects),
        bulletList(text.lines.projects),
        heading(text.sections.education),
        ...p('education'),
        heading(text.sections.skills),
        ...p('skills'),
      ]
    case 'cv-academic':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        heading(text.sections.profile),
        ...p('profile'),
        heading(text.sections.education),
        ...p('education'),
        heading(text.sections.research),
        bulletList(text.lines.research),
        heading(text.sections.teaching),
        ...p('teaching'),
        heading(text.sections.publications),
        ...p('publications'),
        heading(text.sections.awards),
        ...p('awards'),
      ]
    case 'cover-letter':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        ...p('date'),
        heading(text.sections.recipient),
        ...p('recipient'),
        ...p('greeting'),
        heading(text.sections.opening),
        ...p('opening'),
        heading(text.sections.fit),
        ...p('fit'),
        heading(text.sections.closing),
        ...p('closing'),
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
    case 'project-plan':
      return [
        paragraph(text.title, 'Title'),
        paragraph(text.subtitle, 'Subtitle'),
        ...p('prepared'),
        heading(text.sections.objective),
        ...p('objective'),
        heading(text.sections.scope),
        bulletList(text.lines.scope),
        heading(text.sections.milestones),
        orderedList(text.lines.milestones),
        heading(text.sections.risks),
        ...p('risks'),
        heading(text.sections.next),
        ...p('next'),
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
  category: StarterTemplateCategory
  label: string
  description: string
  fileName: string
  document: DraftDocument
}

const categoryById: Record<StarterTemplateId, StarterTemplateCategory> = {
  cv: 'cv',
  'cv-modern': 'cv',
  'cv-academic': 'cv',
  'cover-letter': 'work',
  letter: 'work',
  report: 'work',
  'project-plan': 'work',
  'meeting-notes': 'work',
  essay: 'academic',
}

export function getStarterTemplates(locale: Locale): StarterTemplate[] {
  return starterTemplateIds.map((id) => {
    const text = copy[locale][id]
    return {
      id,
      category: categoryById[id],
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
