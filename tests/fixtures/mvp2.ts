import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chartDocx } from './charts'
import { generatedPNG } from './png'

function packageParts(files: Record<string, Uint8Array>) {
  const overrides = Object.keys(files)
    .filter((p) => p.endsWith('.xml') && !p.startsWith('_'))
    .map((p) => {
      const type = p.includes('/charts/')
        ? 'drawingml.chart'
        : `wordprocessingml.${p === 'word/document.xml' ? 'document.main' : p.split('/').pop()!.replace('.xml', '')}`
      return `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`
    })
  files['[Content_Types].xml'] = strToU8(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join('')}</Types>`,
  )
  files['_rels/.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  let rels = strFromU8(files['word/_rels/document.xml.rels']).replace(
    '<Relationships>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  )
  for (const part of ['styles', 'numbering', 'footnotes'])
    if (files[`word/${part}.xml`])
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${part}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${part}" Target="${part}.xml"/></Relationships>`,
      )
  files['word/_rels/document.xml.rels'] = strToU8(rels)
  return files
}

const image = (id: string, alt: string) =>
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="3048000" cy="1524000"/><wp:docPr id="${id.replace(/\D/g, '') || 1}" name="Picture" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`

// Native XML, independent of Draft's exporter: every MVP 2 document feature shares one file.
export function mixedDocx() {
  const files = unzipSync(chartDocx())
  const xml = strFromU8(files['word/document.xml'])
  const content = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="1" w:name="intro"/><w:r><w:t>Release introduction</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Release details</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First numbered item</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Nested bullet item</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Label</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Release cell</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    ${image('image1', 'Release fixture image')}
    <w:p><w:r><w:t>Note marker</w:t><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:fldSimple w:instr="TOC \\o &quot;1-3&quot; \\h"><w:hyperlink w:anchor="intro"><w:r><w:t>Release introduction</w:t></w:r></w:hyperlink></w:fldSimple></w:p>`
  files['word/document.xml'] = strToU8(xml.replace('<w:body>', '<w:body>' + content))
  files['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']).replace(
      '</Relationships>',
      '<Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    ),
  )
  files['word/media/image1.png'] = generatedPNG(160, 80)
  files['word/styles.xml'] = strToU8(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>',
  )
  files['word/numbering.xml'] = strToU8(
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
  )
  files['word/footnotes.xml'] = strToU8(
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Release footnote source</w:t></w:r></w:p></w:footnote></w:footnotes>',
  )
  return zipSync(packageParts(files))
}

export function imageHeavyDocx(count = 48, seedOffset = 0) {
  const files = unzipSync(chartDocx())
  delete files['word/charts/chart1.xml']
  const paragraphs: string[] = []
  const rels: string[] = []
  for (let i = 1; i <= count; i++) {
    files[`word/media/image${i}.png`] = generatedPNG(512, 256, i + seedOffset)
    paragraphs.push(image(`image${i}`, `Stress image ${i}`))
    rels.push(
      `<Relationship Id="image${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i}.png"/>`,
    )
  }
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']).replace(
      /<w:body>[\s\S]*?<\/w:body>/,
      `<w:body><w:p><w:r><w:t>Image stress fixture</w:t></w:r></w:p>${paragraphs.join('')}</w:body>`,
    ),
  )
  files['word/_rels/document.xml.rels'] = strToU8(`<Relationships>${rels.join('')}</Relationships>`)
  return zipSync(packageParts(files), { level: 0 })
}
