const parseTeacherList = (name) => (process.env[name] || '')
  .split(',')
  .map(teacher => teacher.trim().toUpperCase())
  .filter(Boolean)

const parsePreferredRate = () => {
  const value = process.env.PREFERED_RATE
  if (value === undefined || value.trim() === '') return 1

  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('PREFERED_RATE must be a non-negative number.')
  }
  return rate
}

module.exports = {
  GENERAL_DUTIES: ['SB', 'G'],
  DC_TEAM_MEMBERS: parseTeacherList('DC_TEAM_MEMBERS'),
  TEACHER_ASSISTANTS: parseTeacherList('TEACHER_ASSISTANTS'),
  SKIP_CHECK_EXAMINATIONS: [
    { classlevel: 'S2', title: 'IS PRACTICAL' },
    { classlevel: 'S1', title: 'IS PRACTICAL' },
    { title: 'CHI IV' }
  ],
  BUFFER_TIME: 15,
  F6_BUFFER_TIME: 15,
  PREFERED_RATE: parsePreferredRate(),
  TIMEZONE: 'Asia/Hong_Kong',
  OUTPUT_FILE_PATH: './out',
  VERSION: 'v0.0.0'
}
