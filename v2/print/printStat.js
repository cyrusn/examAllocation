const _ = require('lodash')
const { calculateTeacherStats } = require('../logic')
const { getSheetData, appendRows, batchClearData, clearSheetFormatting, autoResizeRows, setWrapText } = require('../googleSheet')
const { F1_F5_EXAM_PERIOD, F6_EXAM_PERIOD } = require('../constants')
const { Interval, DateTime } = require('luxon')
const { getIntervalBySlot } = require('../utils')

const { getDayLessonsCount } = require('../logic/common')

async function printStat(assignedExaminations, unavailableArrays = [], options = {}) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')
  await clearSheetFormatting(SPREADSHEET_ID, 'stat')
  await setWrapText(SPREADSHEET_ID, 'stat')

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:E')
  
  // Calculate the unique dates that actually have exams scheduled
  const activeExamDates = new Set()
  assignedExaminations.forEach(exam => {
    const examDate = DateTime.fromISO(exam.startDateTime).toFormat('yyyy-MM-dd')
    activeExamDates.add(examDate)
  })

  const limit = options.dailyLessonLimit !== undefined ? options.dailyLessonLimit : 4

  // Initial mapping
  let teachers = rawTeachers.map((t) => {
    const teacherId = (t.teacher || '').trim()
    
    // Calculate total lessons on active exam days
    const teacherLessons = unavailableArrays.filter(u => {
      const matchTeacher = u.teachers.some(initial => initial.trim() === teacherId)
      const isLesson = /[Dd]\s*\d+\s*[Pp]\s*\d+/.test(u.remark || '')
      return matchTeacher && isLesson
    })

    let periodLessons = 0
    teacherLessons.forEach(u => {
      u.slots.forEach(slot => {
        const slotStart = DateTime.fromISO(slot.start)
        if (!slotStart.isValid) return

        // Check if the lesson date is exactly one of the active exam dates
        const lessonDate = slotStart.toFormat('yyyy-MM-dd')
        
        if (activeExamDates.has(lessonDate)) {
          periodLessons++
        }
      })
    })

    // Calculate how many times this teacher was blocked from an exam assignment (by DATE)
    let blockedByLessons = 0
    activeExamDates.forEach(dateStr => {
      let lessonsOnDay = 0
      teacherLessons.forEach(u => {
        u.slots.forEach(slot => {
          const slotStart = DateTime.fromISO(slot.start)
          if (slotStart.isValid && slotStart.toFormat('yyyy-MM-dd') === dateStr) {
            lessonsOnDay++
          }
        })
      })
      
      // Check against the lowest dailyLessonLimit of all exams occurring on that specific date
      const examsOnDate = assignedExaminations.filter(e => e.startDateTime.startsWith(dateStr))
      let limitForDay = 4 // Default fallback
      if (examsOnDate.length > 0) {
        limitForDay = Math.min(...examsOnDate.map(e => parseInt(e.dailyLessonLimit) || 4))
      }

      if (lessonsOnDay >= limitForDay) {
        blockedByLessons++
      }
    })

    return {
      ...t,
      teacher: teacherId,
      originalSubstitutionNumber: parseInt(t.substitutionNumber) || 0,
      totalInvigilationTime: 0,
      fiDuty: 0,
      sbDuty: 0,
      guidanceDuty: 0,
      occurrence: 0,
      periodLessons,
      blockedByLessons
    }
  })

  // Calculate stats using pure logic
  teachers = calculateTeacherStats(teachers, assignedExaminations)

  console.log('Printing Statistic')
  const rows = teachers.reduce((prev, t, idx) => {
    const {
      teacher,
      originalSubstitutionNumber,
      totalInvigilationTime,
      occurrence,
      fiDuty,
      sbDuty,
      guidanceDuty,
      senDuty,
      isSkip,
      periodLessons,
      blockedByLessons
    } = t
    if (idx == 0) {
      prev.push([
        'teacher',
        'originalSubstitutionNumber',
        'assignedPeriods',
        'Balance (Net)',
        'Period Lessons',
        'Blocked by Lessons',
        'totalInvigilationTime',
        'occurrence',
        'fiDuty',
        'sbDuty',
        'guidanceDuty',
        'senDuty',
        'isSkip'
      ])
    }
    const assignedPeriods = Math.round((totalInvigilationTime + 15) / 55)
    prev.push([
      teacher,
      originalSubstitutionNumber,
      assignedPeriods,
      originalSubstitutionNumber + assignedPeriods,
      periodLessons,
      blockedByLessons || 0,
      totalInvigilationTime,
      occurrence,
      fiDuty || 0,
      sbDuty || 0,
      guidanceDuty || 0,
      senDuty || 0,
      isSkip
    ])
    return prev
  }, [])

  // Separate header from data to prevent sorting the header row
  const header = rows[0]
  const data = rows.slice(1)
  
  // Sort data by 'totalInvigilationTime' (index 6) descending
  const sortedData = _.orderBy(data, [6], ['desc'])
  
  // Recombine header and sorted data
  const finalRows = [header, ...sortedData]

  await appendRows(SPREADSHEET_ID, 'stat!A:A', finalRows)
  await autoResizeRows(SPREADSHEET_ID, 'stat')
}

module.exports = { printStat }
