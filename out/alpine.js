const version = 'v0.0.0'
const FILENAME = `result.json`

const groupBy = function (xs, key) {
  return xs.reduce(function (rv, x) {
    ;(rv[x[key]] = rv[x[key]] || []).push(x)
    return rv
  }, {})
}

document.addEventListener('alpine:init', () => {
  Alpine.data('documentData', () => ({
    isLightTheme: false,
    isShowUpdates: false,
    isActive: false,
    isShowFutureMeetings: false,
    filter: '',
    examinations: null,
    toggleTheme() {
      this.isLightTheme = !this.isLightTheme
    },
    fetchExaminationData() {
      const filename = FILENAME
      fetch(`${filename}?nocache=${new Date().getTime()}`)
        .then((response) => response.json())
        .then(
          function (json) {
            this.examinations = json
          }.bind(this)
        )
        .then(function () {
          const id = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Hong_Kong'
          })

          const element = document.getElementById(id)

          if (element) {
            element.scrollIntoView({
              behavior: 'smooth'
            })
          }
        })
    },
    init() {
      this.fetchExaminationData()
    },
    get filteredExaminations() {
      if (!this.examinations) return []

      return this.examinations.filter(
        function (exam) {
          if (!this.filter) return true

          return exam.invigilators.includes(this.filter?.toUpperCase())
        }.bind(this)
      )
    },
    get table() {
      if (!this.filteredExaminations.length) return ''

      const examinations = this.filteredExaminations.map((s) => {
        console.log(s)
        const [date, time] = s.startDateTime.split('T')
        return Object.assign(s, { date, time })
      })

      const groupedExaminationsByDate = groupBy(examinations, 'date')
      const dates = Object.keys(groupedExaminationsByDate)
      let tables = `
<table class="table is-bordered is-striped is-narrow is-hoverable is-fullwidth">
  <tr>
    <th style='width:15%'>Date</th>
    <th style='width:10%'>Time</th>
    <th style='width:10%'>classcode</th>
    <th style='width:30%'>Title</th>
    <th>Location</th>
    <th>Duration</th>
    <th>
      <span class='has-text-danger'>invigilators</span>, 
    </th>
  </tr>`

      dates.forEach((date) => {
        //  const displaySlot = slot.split('T').join('\n').replace(":00.000+08:00", "")
        const groupedExaminations = groupedExaminationsByDate[date]
        const groupedExaminationsByTime = groupBy(groupedExaminations, 'time')
        const times = Object.keys(groupedExaminationsByTime)
        let rowspan = 0

        const sessions = times.map((time) => {
          const examinations = groupedExaminationsByTime[time]
          const timeRowspan = examinations.length

          const rows = examinations.map((s) => {
            rowspan += 1
            const { title, classcode, location, duration, invigilators } = s
            return `
<td>${classcode}</td>
  <td>${title}</td>
  <td>${location || ''}</td> <td>${duration}mins</td>
  <td width='40%'> 
<span class='has-text-info'> ${invigilators.join(', ')}</span>
  </td>`
          })
          return `<td rowspan="${timeRowspan}">${time.slice(0, 5)}
            </td>${rows.join('</tr><tr>')} `
        })
        tables += `<tr id='${date}' style='scroll-margin-top: 80px;'><td rowspan="${rowspan}">${date}</td>`
        tables += sessions.join('</tr><tr>')
        tables += '</tr>'
      })

      tables += '</table>'
      return tables
    }
  }))
})
