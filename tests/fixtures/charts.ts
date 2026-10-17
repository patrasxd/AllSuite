import { strToU8, zipSync } from 'fflate'

export function chartXML(
  type = 'barChart',
  values = '<c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="2"><c:v>30</c:v></c:pt></c:numCache>',
) {
  return `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarterly sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:${type}><c:barDir val="col"/><c:ser><c:tx><c:strRef><c:f>Sheet1!B1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!A2:A4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!B2:B4</c:f>${values}</c:numRef></c:val></c:ser></c:${type}></c:plotArea></c:chart></c:chartSpace>`
}

export function chartDocx(xml = chartXML(), external = false) {
  return zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>Before chart</w:t><w:drawing><wp:inline><wp:extent cx="6096000" cy="3619500"/><a:graphic><a:graphicData><c:chart r:id="chart1"/></a:graphicData></a:graphic></wp:inline></w:drawing><w:t>After chart</w:t></w:r></w:p></w:body></w:document>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships><Relationship Id="chart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="${external ? 'https://unsafe.test/chart.xml' : 'charts/chart1.xml'}" ${external ? 'TargetMode="External"' : ''}/></Relationships>`,
    ),
    'word/charts/chart1.xml': strToU8(xml),
  })
}
