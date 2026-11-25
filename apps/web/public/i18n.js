// UI strings in English and Russian. Missing Russian keys fall back to English.

const STRINGS = {
  en: {
    'nav.overview': 'Overview', 'nav.jobs': 'Jobs', 'nav.datasets': 'Datasets', 'nav.events': 'Events',
    'nav.about': 'About Nexus', 'nav.section': 'Workspace', 'nav.skip': 'Skip to content',
    'search.placeholder': 'Search jobs and datasets…', 'search.label': 'Search',
    'title.overview': 'Operations overview', 'title.jobs': 'Jobs', 'title.datasets': 'Datasets',
    'title.events': 'Events', 'title.lineage': 'Lineage', 'title.search': 'Search', 'title.about': 'About Nexus',
    'subtitle.overview': 'Live health, incidents and business impact across every pipeline.',
    'subtitle.jobs': 'Every job with its health score and recent run history.',
    'subtitle.datasets': 'Datasets by namespace, with schema size and freshness.',
    'subtitle.events': 'Raw OpenLineage events as they arrive.',
    'subtitle.lineage': 'Upstream sources, downstream consumers and blast radius.',
    'subtitle.search': 'Matching jobs and datasets across all namespaces.',
    'subtitle.about': 'What Nexus is and where the data comes from.',
    'status.connecting': 'Connecting', 'status.loading': 'Loading', 'status.connected': 'Live metadata',
    'status.unavailable': 'Metadata unavailable', 'status.local': 'Local workspace',
    'kpi.jobs': 'Jobs', 'kpi.datasets': 'Datasets', 'kpi.failing': 'Failing now', 'kpi.health': 'Average health', 'kpi.namespaces': 'Namespaces', 'lineage.fit': 'Fit to width', 'health.lowest': 'Needs attention',
    'kpi.failingHint': 'latest run failed', 'kpi.healthHint': 'across scored jobs',
    'incidents.title': 'Active incidents', 'incidents.none': 'All pipelines are healthy. No failed latest runs.',
    'incidents.impact': 'Blast radius', 'incidents.outputs': 'business outputs at risk',
    'incidents.jobs': 'downstream jobs', 'incidents.datasets': 'downstream datasets',
    'chart.runs': 'Run outcomes, last 10 days', 'chart.ok': 'Succeeded', 'chart.failed': 'Failed',
    'health.title': 'Health distribution', 'health.healthy': 'Healthy', 'health.watch': 'Watch',
    'health.risk': 'At risk', 'health.unknown': 'No data',
    'health.explain': 'Score = 70 × success rate of the last 10 runs + 30 if the latest run succeeded.',
    'activity.title': 'Recent activity',
    'col.job': 'Job', 'col.namespace': 'Namespace', 'col.health': 'Health', 'col.history': 'Last 10 runs',
    'col.lastRun': 'Last run', 'col.duration': 'Duration', 'col.updated': 'Updated', 'col.dataset': 'Dataset',
    'col.type': 'Type', 'col.fields': 'Fields', 'col.event': 'Event', 'col.time': 'Time (local)',
    'col.origin': 'Origin', 'col.destination': 'Destination', 'col.name': 'Name', 'col.kind': 'Kind',
    'empty.jobs': 'No jobs were found.', 'empty.datasets': 'No datasets were found in this namespace.',
    'empty.events': 'No lineage events have arrived.', 'empty.namespaces': 'No namespaces are available.',
    'empty.lineage': 'Select a job or dataset to view its lineage.', 'empty.edges': 'No lineage edges were returned.',
    'empty.search': 'Nothing matched this search.', 'empty.query': 'Type a job or dataset name in the search box.',
    'filter.namespace': 'Namespace', 'page.previous': 'Previous', 'page.next': 'Next', 'page.of': 'of',
    'page.none': '0 results', 'loading': 'Loading metadata…',
    'error.title': 'Unable to load this view', 'error.retry': 'Retry', 'error.notFound': 'This metadata record was not found.',
    'error.service': 'The metadata service could not complete this request.',
    'error.shape': 'Unexpected metadata response.', 'error.unknown': 'An unexpected error occurred.',
    'kind.job': 'Job', 'kind.dataset': 'Dataset', 'page.label': 'Pagination',
    'state.NEW': 'new', 'state.RUNNING': 'running', 'state.COMPLETED': 'completed', 'state.FAILED': 'failed',
    'state.ABORTED': 'aborted', 'state.START': 'start', 'state.COMPLETE': 'complete', 'state.FAIL': 'fail',
    'state.ABORT': 'abort', 'state.OTHER': 'other', 'state.UNKNOWN': 'unknown',
    'lineage.graph': 'Lineage graph', 'lineage.nodes': 'nodes', 'lineage.edges': 'edges',
    'lineage.upstream': 'Upstream', 'lineage.downstream': 'Downstream', 'lineage.table': 'Edge list (accessible view)',
    'lineage.legend.job': 'Job', 'lineage.legend.dataset': 'Dataset', 'lineage.legend.failed': 'Failed',
    'lineage.legend.impact': 'Downstream impact', 'lineage.legend.focus': 'Selected',
    'lineage.copy': 'Copy as Mermaid', 'lineage.copied': 'Copied', 'lineage.download': 'Download SVG',
    'lineage.schema': 'Schema', 'lineage.runs': 'Run history', 'lineage.noRuns': 'No runs recorded.',
    'lineage.description': 'Description', 'lineage.outputsAtRisk': 'Business outputs affected if this breaks',
    'lineage.noOutputs': 'Nothing downstream depends on this asset.',
    'about.intro': 'Nexus is a data-lineage and pipeline operations workspace built on the open-source Marquez metadata server and the OpenLineage standard.',
    'about.features': 'What Nexus adds',
    'about.f1': 'Interactive lineage graph with failed nodes and downstream impact highlighted.',
    'about.f2': 'Blast-radius analysis: which business reports break when a job fails.',
    'about.f3': 'Explainable health score for every job, from its last 10 runs.',
    'about.f4': 'One-click export of lineage as Mermaid or SVG for docs and pull requests.',
    'about.f5': 'Read-only by design: the web proxy rejects every metadata write.',
    'about.f6': 'Full English and Russian interface.',
    'about.data': 'Demo data',
    'about.dataText': 'The demo pipeline uses the tables, columns and published row counts of the Brazilian E-Commerce Public Dataset by Olist (CC BY-NC-SA 4.0). Run times and failures are synthetic.',
    'about.license': 'Marquez 0.51.1 source and Apache-2.0 license',
    'unit.min': 'min', 'unit.s': 's',
  },
  ru: {
    'nav.overview': 'Обзор', 'nav.jobs': 'Задачи', 'nav.datasets': 'Наборы данных', 'nav.events': 'События',
    'nav.about': 'О Nexus', 'nav.section': 'Рабочая область', 'nav.skip': 'Перейти к содержимому',
    'search.placeholder': 'Поиск задач и наборов данных…', 'search.label': 'Поиск',
    'title.overview': 'Обзор операций', 'title.jobs': 'Задачи', 'title.datasets': 'Наборы данных',
    'title.events': 'События', 'title.lineage': 'Происхождение данных', 'title.search': 'Поиск', 'title.about': 'О Nexus',
    'subtitle.overview': 'Состояние, инциденты и влияние на бизнес по всем конвейерам в реальном времени.',
    'subtitle.jobs': 'Все задачи с оценкой состояния и историей последних запусков.',
    'subtitle.datasets': 'Наборы данных по пространствам имён: схема и актуальность.',
    'subtitle.events': 'Исходные события OpenLineage по мере поступления.',
    'subtitle.lineage': 'Источники, потребители и радиус влияния.',
    'subtitle.search': 'Найденные задачи и наборы данных во всех пространствах имён.',
    'subtitle.about': 'Что такое Nexus и откуда берутся данные.',
    'status.connecting': 'Подключение', 'status.loading': 'Загрузка', 'status.connected': 'Метаданные онлайн',
    'status.unavailable': 'Метаданные недоступны', 'status.local': 'Локальная среда',
    'kpi.jobs': 'Задачи', 'kpi.datasets': 'Наборы данных', 'kpi.failing': 'Сбоев сейчас', 'kpi.health': 'Среднее состояние', 'kpi.namespaces': 'Пространства имён', 'lineage.fit': 'Вписать по ширине', 'health.lowest': 'Требуют внимания',
    'kpi.failingHint': 'последний запуск неуспешен', 'kpi.healthHint': 'по оценённым задачам',
    'incidents.title': 'Активные инциденты', 'incidents.none': 'Все конвейеры исправны. Неуспешных запусков нет.',
    'incidents.impact': 'Радиус влияния', 'incidents.outputs': 'бизнес-отчётов под угрозой',
    'incidents.jobs': 'зависимых задач', 'incidents.datasets': 'зависимых наборов',
    'chart.runs': 'Результаты запусков за 10 дней', 'chart.ok': 'Успешно', 'chart.failed': 'Сбой',
    'health.title': 'Распределение состояния', 'health.healthy': 'Исправно', 'health.watch': 'Внимание',
    'health.risk': 'Под угрозой', 'health.unknown': 'Нет данных',
    'health.explain': 'Оценка = 70 × доля успешных из 10 последних запусков + 30, если последний запуск успешен.',
    'activity.title': 'Последние события',
    'col.job': 'Задача', 'col.namespace': 'Пространство', 'col.health': 'Состояние', 'col.history': '10 запусков',
    'col.lastRun': 'Последний запуск', 'col.duration': 'Длительность', 'col.updated': 'Обновлено',
    'col.dataset': 'Набор данных', 'col.type': 'Тип', 'col.fields': 'Поля', 'col.event': 'Событие',
    'col.time': 'Время (местное)', 'col.origin': 'Откуда', 'col.destination': 'Куда', 'col.name': 'Название',
    'col.kind': 'Вид',
    'empty.jobs': 'Задачи не найдены.', 'empty.datasets': 'В этом пространстве нет наборов данных.',
    'empty.events': 'События ещё не поступали.', 'empty.namespaces': 'Нет доступных пространств имён.',
    'empty.lineage': 'Выберите задачу или набор данных.', 'empty.edges': 'Связи не найдены.',
    'empty.search': 'Ничего не найдено.', 'empty.query': 'Введите название задачи или набора данных.',
    'filter.namespace': 'Пространство', 'page.previous': 'Назад', 'page.next': 'Далее', 'page.of': 'из',
    'page.none': '0 результатов', 'loading': 'Загрузка метаданных…',
    'error.title': 'Не удалось загрузить страницу', 'error.retry': 'Повторить',
    'error.notFound': 'Запись метаданных не найдена.', 'error.service': 'Сервис метаданных не смог выполнить запрос.',
    'error.shape': 'Неожиданный ответ сервиса.', 'error.unknown': 'Произошла непредвиденная ошибка.',
    'kind.job': 'Задача', 'kind.dataset': 'Набор данных', 'page.label': 'Страницы',
    'state.NEW': 'новый', 'state.RUNNING': 'выполняется', 'state.COMPLETED': 'успешно', 'state.FAILED': 'сбой',
    'state.ABORTED': 'прерван', 'state.START': 'старт', 'state.COMPLETE': 'завершён', 'state.FAIL': 'сбой',
    'state.ABORT': 'прерван', 'state.OTHER': 'другое', 'state.UNKNOWN': 'неизвестно',
    'lineage.graph': 'Граф происхождения', 'lineage.nodes': 'узлов', 'lineage.edges': 'связей',
    'lineage.upstream': 'Выше по потоку', 'lineage.downstream': 'Ниже по потоку',
    'lineage.table': 'Список связей (доступный вид)',
    'lineage.legend.job': 'Задача', 'lineage.legend.dataset': 'Набор данных', 'lineage.legend.failed': 'Сбой',
    'lineage.legend.impact': 'Зона влияния', 'lineage.legend.focus': 'Выбрано',
    'lineage.copy': 'Копировать Mermaid', 'lineage.copied': 'Скопировано', 'lineage.download': 'Скачать SVG',
    'lineage.schema': 'Схема', 'lineage.runs': 'История запусков', 'lineage.noRuns': 'Запусков нет.',
    'lineage.description': 'Описание', 'lineage.outputsAtRisk': 'Бизнес-отчёты, которые пострадают при сбое',
    'lineage.noOutputs': 'От этого объекта ничего не зависит.',
    'about.intro': 'Nexus — рабочая область для происхождения данных и эксплуатации конвейеров на базе open-source сервера метаданных Marquez и стандарта OpenLineage.',
    'about.features': 'Что добавляет Nexus',
    'about.f1': 'Интерактивный граф с подсветкой сбоев и зоны влияния.',
    'about.f2': 'Анализ радиуса влияния: какие бизнес-отчёты сломаются при сбое задачи.',
    'about.f3': 'Понятная оценка состояния каждой задачи по 10 последним запускам.',
    'about.f4': 'Экспорт графа в Mermaid или SVG в один клик — для документации и pull request.',
    'about.f5': 'Только чтение: веб-прокси отклоняет любую запись метаданных.',
    'about.f6': 'Полный интерфейс на английском и русском.',
    'about.data': 'Демо-данные',
    'about.dataText': 'Демо-конвейер использует таблицы, столбцы и опубликованные объёмы открытого набора Brazilian E-Commerce Public Dataset by Olist (CC BY-NC-SA 4.0). Время запусков и сбои синтетические.',
    'about.license': 'Исходный код Marquez 0.51.1 и лицензия Apache-2.0',
    'unit.min': 'мин', 'unit.s': 'с',
  },
}

const STORAGE_KEY = 'nexus.lang'

function stored() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export let lang = Object.hasOwn(STRINGS, stored()) ? stored()
  : navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'

export function setLang(next) {
  if (!Object.hasOwn(STRINGS, next)) return
  lang = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode: keep in memory only */ }
}

export function t(key) {
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key
}

/** Run state or event type in the current language; unknown values fall back to lower case. */
export function stateLabel(value) {
  const raw = String(value ?? 'UNKNOWN')
  return STRINGS[lang][`state.${raw}`] ?? raw.toLowerCase()
}

/** Fill static markup: data-i18n sets text, data-i18n-placeholder sets placeholder. */
export function translateDocument(root = document) {
  document.documentElement.lang = lang
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder)
    node.setAttribute('aria-label', t(node.dataset.i18nPlaceholder))
  }
}

export const KEYS = { en: Object.keys(STRINGS.en), ru: Object.keys(STRINGS.ru) }
