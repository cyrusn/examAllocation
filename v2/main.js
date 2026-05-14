require('dotenv').config()
const _ = require('lodash')
const fs = require('fs')
const {
  validateAssignments,
  validateCollisions,
  sanitizeCollisions
} = require('./logic')
const {
  printView,
  printStat,
  printSen,
  printTeacherView
} = require('./print')
const { getSheetData } = require('./googleSheet')
const { allocateExaminations } = require('./allocator')
const { parseTeachers, parseUnavailables, parseExaminations } = require('./parser')
const { OUTPUT_FILE_PATH } = require('./constants')

/**
 * Parses command-line arguments.
 */
const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    sbDuration: 180,
    dailyLessonLimit: undefined,
    help: false
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sb-duration' || args[i] === '-s') {
      const val = parseInt(args[i + 1])
      if (!isNaN(val)) {
        options.sbDuration = val
        i++
      }
    } else if (args[i] === '--daily-lesson-limit' || args[i] === '-l') {
      const val = parseInt(args[i + 1])
      if (!isNaN(val)) {
        options.dailyLessonLimit = val
        i++
      }
    } else if (args[i] === '--help' || args[i] === '-h') {
      options.help = true
    }
  }
  return options
}

/**
 * Displays help information.
 */
const showHelp = () => {
  console.log(`
Examination Allocation CLI Help
-------------------------------
Usage: node v2/main.js [options]

Options:
  --sb-duration, -s <minutes>         Adjust the duration of Standby/Guidance/Morning duties (default: 180)
  --daily-lesson-limit, -l <count>    Do not assign exams to teachers who have this many (or more) lessons on the same day.
  --help, -h                          Show this help message

Examples:
  node v2/main.js --sb-duration 120
  node v2/main.js -l 2
  node v2/main.js -s 150 -l 3
  `)
}

const main = async () => {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    return
  }

  console.log('Allocating Examinations (v2)...')
  if (options.sbDuration !== 180) {
    console.log(`Custom SB Duration: ${options.sbDuration} minutes`)
  }
  if (options.dailyLessonLimit !== undefined) {
    console.log(`Daily Lesson Limit: Exclude teachers with >= ${options.dailyLessonLimit} lessons/day`)
  }
  console.time('Time to finish')
  
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']

  // 1. Fetch Data
  const [ 
    rawExaminations,
    rawUnavailables,
    ignoredSlots,
    rawTeachers
  ] = await Promise.all([
    getSheetData(SPREADSHEET_ID, 'exam!A:O'),
    getSheetData(SPREADSHEET_ID, 'unavailables!A:C'),
    getSheetData(SPREADSHEET_ID, 'ignoredUnavailables!A:D'),
    getSheetData(SPREADSHEET_ID, 'teachers!A:E')
  ])

  // 2. Prepare Data
  let teachers = parseTeachers(rawTeachers)
  const unavailableArrays = parseUnavailables(rawUnavailables)
  const examinations = parseExaminations(rawExaminations, options)

  // 3. Initialize Assignments & Sanitize Pre-assignments
  let assignedExaminations = sanitizeCollisions(examinations)
  
  // 4. Run Allocation (Core Logic)
  assignedExaminations = allocateExaminations(examinations, teachers, unavailableArrays, options)

  console.log(`\n${assignedExaminations.length} examinations are assigned.`) // Added escape for 

  // 5. Sort and Validate
  const finalAssignedExaminations = _.sortBy(assignedExaminations, [
    'startDateTime',
    'classlevel',
    'classcode'
  ])

  // Validation Checks
  const crashes = validateAssignments(finalAssignedExaminations, unavailableArrays, ignoredSlots)
  if (crashes.length > 0) {
    console.error('Validation Failed: Assignments crash with availability.')
    crashes.forEach(c => {
       console.log(`${c.exam.id} ${c.exam.title}: ${c.invigilator} unavailable at ${c.slot.start}-${c.slot.end} (${c.remark})`)
    })
  } else {
    console.log('Availability Validation Passed.')
  }

  const collisions = validateCollisions(finalAssignedExaminations)
  if (collisions.length > 0) {
    console.error('Validation Failed: Invigilator Collisions Detected.')
    collisions.forEach(c => {
      console.log(`Collision: [${c.teachers.join(', ')}] in ${c.examA.id} (${c.examA.title}) and ${c.examB.id} (${c.examB.title})`)
    })
  } else {
    console.log('Collision Validation Passed.')
  }

  // Check for UNASSIGNED
  const unassignedExams = finalAssignedExaminations.filter(e => e.invigilators.includes('UNASSIGNED'))
  if (unassignedExams.length > 0) {
    console.error('\n⚠️ WARNING: Some exams could not be fully assigned.')
    unassignedExams.forEach(e => {
      const missingCount = e.invigilators.filter(i => i === 'UNASSIGNED').length
      console.log(`- ${e.id} (${e.title}) on ${e.startDateTime.substring(0, 10)} needs ${missingCount} more invigilator(s).`)
    })
  } else {
    console.log('\n✅ All exams were successfully assigned.')
  }

  // 6. Output
  if (!fs.existsSync(OUTPUT_FILE_PATH)) {
    fs.mkdirSync(OUTPUT_FILE_PATH, { recursive: true })
  }
  
  fs.writeFileSync(
    OUTPUT_FILE_PATH + '/result.json',
    JSON.stringify(finalAssignedExaminations, null, 2),
    'utf8'
  )

  await printStat(finalAssignedExaminations, unavailableArrays)
  await printView(finalAssignedExaminations, teachers)
  await printSen(finalAssignedExaminations)
  await printTeacherView(finalAssignedExaminations)

  console.timeEnd('Time to finish')
}

main().catch(console.error)
