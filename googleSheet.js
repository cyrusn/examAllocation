const _ = require('lodash')
const { google } = require('googleapis')

const { DateTime } = require('luxon')
const TIMEZONE = 'Asia/Hong_Kong'

// Load the service account key from the JSON file

const sheets = google.sheets('v4')

function convertRowsToCollection(rows) {
  const headers = rows.shift()
  return rows.map((row) => {
    return row.reduce((prev, cell, n) => {
      return { ...prev, [headers[n]]: cell }
    }, {})
  })
}

async function getAuth() {
  const client = new google.auth.GoogleAuth({
    keyFile: './.env.key.json',
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly',
      'https://www.googleapis.com/auth/gmail.send'
    ]
  })

  const cachedClient = await client.getClient() // Authenticate and cache the client
  cachedClient.subject = 'schooladmin@liping.edu.hk'
  return cachedClient
}

async function batchUpdateSpreadsheet(spreadsheetId, headerRange, rowObjects) {
  try {
    const auth = await getAuth()
    const headerResponse = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: headerRange,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    })
    const headerRow = headerResponse.data.values[0]

    const data = rowObjects.map((obj) => {
      obj.timestamp = DateTime.now().setZone(TIMEZONE).toISO()
      return {
        range: obj.range,
        values: [
          headerRow.map((key) => {
            const value = obj[key]
            return Array.isArray(value) ? value.join(',') : value
          })
        ]
      }
    })
    const response = await sheets.spreadsheets.values.batchUpdate({
      auth,
      spreadsheetId,
      resource: { data, valueInputOption: 'USER_ENTERED' }
    })

    return response.data.totalUpdatedRows
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}

async function getSheetKeyValueData(spreadsheetId, range) {
  try {
    const auth = await getAuth()
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    })

    const rows = response.data.values
    return _.fromPairs(rows)
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}

async function getSheetData(spreadsheetId, range) {
  try {
    const auth = await getAuth()
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    })

    const rows = response.data.values
    return convertRowsToCollection(rows)
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}
async function batchGetSheetDataByColumn(spreadsheetId, ranges) {
  try {
    const auth = await getAuth()
    const response = await sheets.spreadsheets.values.batchGet({
      auth,
      spreadsheetId,
      ranges,
      majorDimension: 'COLUMNS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    })
    const zippedResult = _.zip(
      ...response.data.valueRanges.reduce((prev, { range, values }) => {
        prev.push(...values, [
          ...values[0].map((_, index) => {
            if (index == 0) return 'range'
            const row = index + 1
            return `${range.split('!')[0]}!${row}:${row}`
          })
        ])
        return prev
      }, [])
    )
    return convertRowsToCollection(zippedResult)
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}

async function batchGetSheetDataByRow(spreadsheetId, ranges) {
  try {
    const auth = await getAuth()
    const response = await sheets.spreadsheets.values.batchGet({
      auth,
      spreadsheetId,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    })

    const rows = response.data.valueRanges.reduce((prev, cur, index) => {
      const { values, range } = cur

      if (index == 0) {
        const row = values[0]

        prev.push(['range', ...row])
        return prev
      }

      prev.push([range, ...values[0]])
      return prev
    }, [])

    return convertRowsToCollection(rows)
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}

async function batchClearData(spreadsheetId, ranges) {
  try {
    const auth = await getAuth()
    const response = await sheets.spreadsheets.values.batchClear({
      auth,
      spreadsheetId,
      resource: { ranges }
    })
    return response.data
  } catch (error) {
    console.error('Error clearing data from Google Sheets:', error)
    throw error // Rethrow the error to handle it in the calling function
  }
}

async function appendRows(spreadsheetId, range, values) {
  const resource = {
    values: values.map((row) =>
      row.map((v) => (Array.isArray(v) ? v.join(',') : v))
    )
  }

  const auth = await getAuth()
  const response = await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    resource
  })
  return response.data // Return the response data
}

module.exports = {
  appendRows,
  batchClearData,
  getSheetData,
  batchUpdateSpreadsheet,
  getSheetKeyValueData,
  batchGetSheetDataByColumn,
  batchGetSheetDataByRow
}
