export const assistantQuestions = [
  { question: 'How many assets do we have?', permission: 'asset.view' },
  { question: 'Which borrowed items are overdue?', permission: 'itlog.view' },
  { question: 'Which warranties expire soon?', permission: 'asset.view' },
  { question: 'How do I lend an item?', permission: 'itlog.view' },
  { question: 'How do I log a repair?', permission: 'itlog.view' },
  { question: 'How do I assign assets to a new hire?', permission: 'asset.edit' },
  { question: 'How do I offboard an employee?', permission: 'asset.edit' },
  { question: 'How do I upload a document?', permission: 'document.view' },
  { question: 'How do I add a passkey?', permission: null },
  { question: 'What expires in the next 30 days?', permission: 'record.view' },
  { question: 'What expires in the next 7 days?', permission: 'record.view' },
  { question: 'What expires today?', permission: 'record.view' },
  { question: 'Show overdue records', permission: 'record.view' },
  { question: 'How many records do I have?', permission: 'record.view' },
  { question: 'How do I use saved views?', permission: 'record.view' },
  { question: 'How do I change visible columns?', permission: 'record.view' },
  { question: 'How do I import records?', permission: 'record.create' },
  { question: 'How do I customize reminder messages?', permission: 'reminder.view' },
  { question: 'How do Telegram recipients work?', permission: 'notification.view' },
  { question: 'How do renewal forecasts work?', permission: 'report.view' },
  { question: 'How do I configure record fields?', permission: 'record_type.view' },
  { question: 'How do I change the timezone?', permission: 'settings.view' },
  { question: 'How do I use audit logs?', permission: null, systemAdminOnly: true },
  { question: 'How do I change my password?', permission: null },
  { question: 'How do I update my profile?', permission: null },
  { question: 'How do I use Recently Viewed?', permission: null },
  { question: 'How do I get around the app?', permission: null },
  { question: 'What can you do?', permission: null },
]

export function shuffledQuestions(can: (permission: string) => boolean, isSystemAdmin: boolean, previous: string[], context = '', exclude = ''): string[] {
  const pool = assistantQuestions.filter(q =>
    (!q.systemAdminOnly || isSystemAdmin) && (!q.permission || can(q.permission)) && q.question !== exclude,
  ).map(q => q.question)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const pattern = /assets|asset|warrant|laptop/.test(context) ? /asset|warrant|assign|repair/ : /it-logs|borrow|repair|lend/.test(context) ? /borrow|lend|repair|overdue/ : /documents|upload/.test(context) ? /document|upload/ : /employees|offboard|quick-actions/.test(context) ? /offboard|assign/ : /reports|forecast/.test(context) ? /forecast/ : /notifications|telegram/.test(context) ? /Telegram|reminder/ : /renewals|reminder/.test(context) ? /reminder|expir|overdue/ : /record-types|fields/.test(context) ? /fields|import/ : /records|expir|overdue/.test(context) ? /records|expir|overdue|columns|views/ : /settings|profile|password/.test(context) ? /password|profile|timezone/ : null
  if (pattern) pool.sort((a, b) => Number(pattern.test(b)) - Number(pattern.test(a)))
  let selected = pool.slice(0, 3)
  // A fresh expansion always changes the sequence, even if the shuffle repeats.
  if (selected.join('|') === previous.join('|')) selected = [...selected.slice(1), pool[3] || selected[0]]
  return selected
}
