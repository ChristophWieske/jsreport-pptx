const archiver = require('archiver')
const fs = require('fs')
const decompress = require('./decompress')
const renderEngine = require('./renderEngine')
const toArray = require('stream-to-array')
const Promise = require('bluebird')
const preprocess = require('./preprocess/preprocess.js')
const postprocess = require('./postprocess/postprocess.js')
const toArrayAsync = Promise.promisify(toArray)
const axios = require('axios')
const FormData = require('form-data')
const { DOMParser, XMLSerializer } = require('xmldom')

module.exports = (reporter, definition) => async (req, res) => {
  if (!req.template.pptx || (!req.template.pptx.templateAsset && !req.template.pptx.templateAssetShortid)) {
    throw reporter.createError(`docx requires template.pptx.templateAsset or template.pptx.templateAssetShortid to be set`, {
      statusCode: 400
    })
  }

  let templateAsset = req.template.pptx.templateAsset

  if (req.template.pptx.templateAssetShortid) {
    templateAsset = await reporter.documentStore.collection('assets').findOne({ shortid: req.template.pptx.templateAssetShortid }, req)

    if (!templateAsset) {
      throw reporter.createError(`Asset with shortid ${req.template.pptx.templateAssetShortid} was not found`, {
        statusCode: 400
      })
    }
  } else {
    if (!Buffer.isBuffer(templateAsset.content)) {
      templateAsset.content = Buffer.from(templateAsset.content, templateAsset.encoding || 'utf8')
    }
  }

  const files = await decompress()(templateAsset.content)

  for (const f of files) {
    if (f.path.includes('.xml')) {
      f.doc = new DOMParser().parseFromString(f.data.toString())
      f.data = f.data.toString()
    }
  }

  await preprocess(files)

  for (const f of files) {
    if (f.path.includes('.xml')) {
      const content = new XMLSerializer().serializeToString(f.doc).replace(/<pptxRemove>/g, '').replace(/<\/pptxRemove>/g, '')
      f.data = await renderEngine(reporter, {
        data: req.data,
        content,
        req,
        pathToEngine: req.template.pathToEngine,
        helpers: req.template.helpers
      })
      f.doc = new DOMParser().parseFromString(f.data.toString())
    }
  }

  await postprocess(files)

  for (const f of files) {
    if (f.path.includes('.xml')) {
      f.data = Buffer.from(new XMLSerializer().serializeToString(f.doc))
    }
  }

  const {
    pathToFile: xlsxFileName,
    stream: output
  } = await reporter.writeTempFileStream((uuid) => `${uuid}.pptx`)

  await new Promise((resolve, reject) => {
    const archive = archiver('zip')

    output.on('close', () => {
      reporter.logger.debug('Successfully zipped now.', req)
      res.stream = fs.createReadStream(xlsxFileName)
      resolve()
    })

    archive.on('error', (err) => reject(err))

    archive.pipe(output)

    files.forEach((f) => archive.append(f.data, { name: f.path }))

    archive.finalize()
  })

  res.content = Buffer.concat(await toArrayAsync(res.stream))

  if (!req.options.preview || definition.options.previewInWordOnline === false) {
    res.meta.fileExtension = 'pptx'
    res.meta.contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    return
  }

  const form = new FormData()
  form.append('field', res.content, 'file.pptx')
  const resp = await axios.post(definition.options.publicUriForPreview || 'http://jsreport.net/temp', form, {
    headers: form.getHeaders()
  })

  const iframe = '<iframe style="height:100%;width:100%" src="https://view.officeapps.live.com/op/view.aspx?src=' +
    encodeURIComponent((definition.options.publicUriForPreview || 'http://jsreport.net/temp' + '/') + resp.data) + '" />'
  const html = '<html><head><title>jsreport</title><body>' + iframe + '</body></html>'
  res.content = Buffer.from(html)
  res.meta.contentType = 'text/html'
  res.meta.fileExtension = 'docx'
}
