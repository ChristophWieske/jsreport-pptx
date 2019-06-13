import Properties from './PptxProperties'
import Studio from 'jsreport-studio'

Studio.addPropertiesComponent(Properties.title, Properties, (entity) => entity.__entitySet === 'templates' && entity.recipe === 'pptx')

Studio.addApiSpec({
  template: {
    pptx: {
      templateAsset: {
        encoding: '...',
        content: '...'
      },
      templateAssetShortid: '...'
    }
  }
})

Studio.previewListeners.push((request, entities) => {
  if (request.template.recipe !== 'pptx') {
    return
  }

  if (Studio.extensions.pptx.options.previewInOfficeOnline === false) {
    return
  }

  if (Studio.getSettingValueByKey('office-preview-informed', false) === true) {
    return
  }

  Studio.setSetting('office-preview-informed', true)

  Studio.openModal(() => <div>
    We need to upload your pptx report to our publicly hosted server to be able to use
    Office Online Service for previewing here in the studio. You can disable it in the configuration, see <a
      href='https://jsreport.net/learn/pptx' target='_blank'>https://jsreport.net/learn/pptx</a> for details.
  </div>)
})
