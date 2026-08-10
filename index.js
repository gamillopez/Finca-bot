const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
 
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SHEETS_URL = process.env.SHEETS_URL;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SHEETS_ID = '1jrDtAevRBodjx1rIeQVhwUQJtwTv7bebKc9HHIh3mi0';
 
const catGroup = {
  'Preparación y análisis de suelo':'Gastos de Establecimiento',
  'Plantones de calidad':'Gastos de Establecimiento',
  'Cercado y seguridad':'Gastos de Establecimiento',
  'Equipos y herramientas':'Gastos de Establecimiento',
  'Mantenimiento de plantas':'Gastos Operativos',
  'Nómina y supervisión':'Gastos Operativos',
  'Cosecha y post-cosecha':'Gastos Operativos',
  'Gastos semanales operativos':'Gastos Operativos',
  'Fertilizantes y abonos':'Insumos y Agroquímicos',
  'Control de plagas':'Insumos y Agroquímicos',
  'Materiales varios':'Insumos y Agroquímicos',
  'Combustible':'Maquinaria y Transporte',
  'Reparación y repuestos':'Maquinaria y Transporte',
  'Mantenimiento de maquinaria':'Maquinaria y Transporte',
  'Transporte cosecha/mercados':'Maquinaria y Transporte'
};
 
const nombresMeses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
 
async function sendWhatsApp(to, message) {
  try {
    const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await twilio.messages.create({ from: 'whatsapp:+14155238886', to, body: message });
  } catch(err) {
    console.log('WhatsApp send error (non-fatal):', err.message);
  }
}
 
async function getSheetData() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv&gid=1076796170`;
  const resp = await axios.get(url);
  return resp.data;
}
 
function calcularTotales(csvText) {
  const lines = csvText.split('\n');
  const grupos = {};
  let total = 0;
  let currentGrupo = '';
 
  const grupoKeys = {
    'Gastos de Establecimiento': 'Gastos de Establecimiento',
    'Gastos Operativos': 'Gastos Operativos',
    'Insumos y agroquímicos': 'Insumos y Agroquímicos',
    'Maquinaria y Transporte': 'Maquinaria y Transporte',
    'Servicios y Gastos Administrativos': 'Servicios Admin',
    'Gastos de Cerfificacion': 'Certificación',
  };
 
  for (const line of lines) {
    const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const firstCol = cols[0];
    const montoCol = cols[4] || '';
    
    if (grupoKeys[firstCol]) {
      currentGrupo = grupoKeys[firstCol];
      continue;
    }
    
    if (firstCol === '' && montoCol && !montoCol.includes('Total')) {
      const monto = parseFloat(montoCol.replace(/[$,]/g, '')) || 0;
      if (monto > 0 && currentGrupo) {
        grupos[currentGrupo] = (grupos[currentGrupo] || 0) + monto;
        total += monto;
      }
    }
  }
  return { grupos, total };
}
 
async function procesarReporte(from) {
  try {
    await sendWhatsApp(from, '📊 Generando reporte... un momento.');
 
    const csvData = await getSheetData();
    const { grupos, total } = calcularTotales(csvData);
    const fecha = new Date().toLocaleDateString('es-DO');
    const sorted = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
 
    let msg = `📊 *Reporte Ejecutivo — Finca FAME*\n📅 ${fecha}\n\n`;
    msg += `💰 *TOTAL GENERAL: RD$${total.toLocaleString('es-DO', {minimumFractionDigits:0, maximumFractionDigits:0})}*\n\n`;
    msg += `📋 *Por categoría:*\n`;
 
    const icons = {
      'Insumos y Agroquímicos': '🌱',
      'Gastos Operativos': '⚙️',
      'Maquinaria y Transporte': '🚛',
      'Gastos de Establecimiento': '🏗️',
      'Certificación': '📜',
      'Servicios Admin': '📎',
    };
 
    for (const [grupo, monto] of sorted) {
      const pct = (monto / total * 100).toFixed(1);
      const icon = icons[grupo] || '•';
      msg += `${icon} ${grupo}\n   RD$${monto.toLocaleString('es-DO', {minimumFractionDigits:0, maximumFractionDigits:0})} (${pct}%)\n`;
    }
 
    msg += `\n_Datos tomados de Google Sheets en tiempo real_`;
    await sendWhatsApp(from, msg);
 
  } catch(err) {
    console.error('Error reporte:', err.message);
    await sendWhatsApp(from, '❌ Error generando el reporte. Intenta de nuevo.');
  }
}
 
async function analyzeImageWithClaude(imageUrl) {
  const imgResp = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN }
  });
  const base64 = Buffer.from(imgResp.data).toString('base64');
  const contentType = imgResp.headers['content-type'] || 'image/jpeg';
 
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
        { type: 'text', text: `Analiza este documento de una finca de aguacates. Responde UNICAMENTE con JSON sin backticks:
{"tipo":"factura" o "deposito","fecha":"YYYY-MM-DD","monto":numero,"moneda":"DOP" o "USD","proveedor":"nombre","descripcion":"max 80 chars","numFactura":"si existe","ncf":"si existe","numTransaccion":"si deposito","categoria":"una de: Preparación y análisis de suelo|Plantones de calidad|Cercado y seguridad|Equipos y herramientas|Mantenimiento de plantas|Nómina y supervisión|Cosecha y post-cosecha|Gastos semanales operativos|Fertilizantes y abonos|Control de plagas|Materiales varios|Combustible|Reparación y repuestos|Mantenimiento de maquinaria|Transporte cosecha/mercados"}` }
      ]
    }]
  }, {
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
  });
 
  const text = response.data.content.map(i => i.text || '').join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
 
async function saveToSheets(data) {
  const fecha = new Date(data.fecha);
  const mes = nombresMeses[fecha.getMonth()] || 'Junio';
  const grupo = catGroup[data.categoria] || 'Otros';
  const params = new URLSearchParams({ ...data, mes, grupo });
  await axios.get(`${SHEETS_URL}?${params.toString()}`);
  return { mes, grupo };
}
 
app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const numMedia = parseInt(req.body.NumMedia || '0');
  const body = (req.body.Body || '').trim().toLowerCase();
  res.status(200).send('OK');
 
  try {
    if (body.includes('reporte')) {
      await procesarReporte(from);
    } else if (numMedia > 0) {
      await sendWhatsApp(from, '📷 Recibí tu foto, analizando con IA...');
      const mediaUrl = req.body.MediaUrl0;
      const data = await analyzeImageWithClaude(mediaUrl);
      const { mes, grupo } = await saveToSheets(data);
      const montoFmt = data.moneda === 'USD' ? `US$${parseFloat(data.monto).toLocaleString('es-DO')}` : `RD$${parseFloat(data.monto).toLocaleString('es-DO')}`;
      const tipoIcon = data.tipo === 'factura' ? '🧾' : '🏦';
      const ref = data.tipo === 'factura' ? (data.numFactura ? `Factura: ${data.numFactura}` : '') : (data.numTransaccion ? `Transacción: ${data.numTransaccion}` : '');
      await sendWhatsApp(from,
        `✅ *Gasto registrado en Google Sheets*\n\n${tipoIcon} *${data.tipo === 'factura' ? 'Factura' : 'Depósito'}*\n📅 ${data.fecha} (${mes})\n💰 ${montoFmt}\n🏷️ ${data.categoria}\n📂 ${grupo}\n🏪 ${data.proveedor}\n📝 ${data.descripcion}\n${ref ? `🔢 ${ref}` : ''}`
      );
    } else {
      await sendWhatsApp(from,
        '🥑 *Bot Finca Aguacates*\n\n📷 Manda una foto de factura o comprobante para registrarlo\n📊 Escribe *reporte* para ver el resumen de gastos'
      );
    }
  } catch(err) {
    console.error('Error:', err.message);
    await sendWhatsApp(from, '❌ Hubo un error. Intenta de nuevo.');
  }
});
 
app.get('/', (req, res) => res.send('🥑 Finca Bot activo'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));
 
