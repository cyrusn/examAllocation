require('dotenv').config()
const _ = require('lodash')
const { google } = require('googleapis')
const { DateTime } = require('luxon')

const TIMEZONE = 'Asia/Hong_Kong'

// Ideally, authentication should be passed in or handled by a singleton service
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

  const cachedClient = await client.getClient()
  cachedClient.subject = 'schooladmin@liping.edu.hk'
  return cachedClient
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
    throw error
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
    throw error
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
  return response.data
}

module.exports = {
  getSheetData,
  batchClearData,
  appendRows
}
