/** Tiny, local documents containing "Hello Library"; no third-party fixture downloads.
 * The archive port exposes the fixture's known stored XML entries; real ZIP parsing is done
 * by Mammoth in the integration test and ingress archive guards have their own contract suite. */
import type { DocumentArchiveReaderPort } from '../../document-ingress.js';
export const tinyPdf = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDQgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA1MCAxNTAgVGQgKEhlbGxvIExpYnJhcnkpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDUKJSVFT0YK', 'base64');
export const tinyDocx = Buffer.from('UEsDBBQAAAAAAHl6XF33S4B1dgEAAHYBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIj48RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPjxEZWZhdWx0IEV4dGVuc2lvbj0ieG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24veG1sIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIvd29yZC9kb2N1bWVudC54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQud29yZHByb2Nlc3NpbmdtbC5kb2N1bWVudC5tYWluK3htbCIvPjwvVHlwZXM+UEsDBBQAAAAAAHl6XF1hey9D8gAAAPIAAAALAAAAX3JlbHMvLnJlbHM8UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9IndvcmQvZG9jdW1lbnQueG1sIi8+PC9SZWxhdGlvbnNoaXBzPlBLAwQUAAAAAAB5elxdqkBJhJ8AAACfAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sPHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj48dzpib2R5Pjx3OnA+PHc6cj48dzp0PkhlbGxvIExpYnJhcnk8L3c6dD48L3c6cj48L3c6cD48L3c6Ym9keT48L3c6ZG9jdW1lbnQ+UEsBAhQDFAAAAAAAeXpcXfdLgHV2AQAAdgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAAAAB5elxdYXsvQ/IAAADyAAAACwAAAAAAAAAAAAAAgAGnAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAAAAB5elxdqkBJhJ8AAACfAAAAEQAAAAAAAAAAAAAAgAHCAgAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAkAMAAAAA', 'base64');
const members: Record<string, string> = {
  "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
  "_rels/.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
  "word/document.xml": "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Hello Library</w:t></w:r></w:p></w:body></w:document>"
};
export const fixtureArchiveReader: DocumentArchiveReaderPort = {
  async *entries({ archive }) {
    if (!Buffer.from(archive).equals(tinyDocx)) throw new Error('unexpected fixture archive');
    for (const [entryPath, xml] of Object.entries(members)) {
      const bytes = Buffer.from(xml);
      yield { entryPath, kind: 'file' as const, declaredSize: bytes.length, compressedSize: bytes.length,
        async *openReadStream() { yield bytes; } };
    }
  },
};
