const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const SHEETS_URL = process.env.SHEETS_URL;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

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
  const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: to,
    body: message
  });
}

async function analyzeImageWithClaude(imageUrl) {
  // Download image from Twilio
  const imgResp = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: TWILIO_ACCOUNT_SID,
      password: TWILIO_AUTH_TOKEN
    }
  });
  
  const base64 = Buffer.from(imgResp.data).toString('base64');
  const contentType = imgResp.headers['content-type'] || 'image/jpeg';

  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: contentType, data: base64 }
        },
        {
          type: 'text',
          text: `Analiza este documento (factura o comprobante de depósito/transferencia) de una finca de aguacates. Responde ÚNICAMENTE con JSON sin backticks:
{
  "tipo": "factura" o "deposito",
  "fecha": "YYYY-MM-DD",
  "monto": número sin símbolos,
  "moneda": "DOP" o "USD" o "EUR" o "Otra",
  "proveedor": "nombre del proveedor o destinatario",
  "descripcion": "descripción breve máx 80 chars",
  "numFactura": "número de factura si existe, sino vacío",
  "ncf": "número NCF si existe, sino vacío",
  "numTransaccion": "número de transacción si es depósito, sino vacío",
  "categoria": "una de estas: Preparación y análisis de suelo|Plantones de calidad|Cercado y seguridad|Equipos y herramientas|Mantenimiento de plantas|Nómina y supervisión|Cosecha y post-cosecha|Gastos semanales operativos|Fertilizantes y abonos|Control de plagas|Materiales varios|Combustible|Reparación y repuestos|Mantenimiento de maquinaria|Transporte cosecha/mercados"
}`
        }
      ]
    }]
  }, {
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }
  });

  const text = response.data.content.map(i => i.text || '').join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function saveToSheets(data) {
  const fecha = new Date(data.fecha);
  const mes = nombresMeses[fecha.getMonth()] || 'Junio';
  const grupo = catGroup[data.categoria] || 'Otros';

  const params = new URLSearchParams({
    fecha: data.fecha,
    mes,
    categoria: data.categoria,
    grupo,
    proveedor: data.proveedor || '',
    descripcion: data.descripcion || '',
    monto: data.monto,
    moneda: data.moneda || 'DOP',
    tipo: data.tipo || 'factura',
    numFactura: data.numFactura || '',
    ncf: data.ncf || '',
    numTransaccion: data.numTransaccion || ''
  });

  await axios.get(`${SHEETS_URL}?${params.toString()}`);
  return { mes, grupo };
}

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const numMedia = parseInt(req.body.NumMedia || '0');
  const body = (req.body.Body || '').trim().toLowerCase();

  res.status(200).send('OK');

  try {
    if (numMedia > 0) {
      // Has image
      await sendWhatsApp(from, '📷 Recibí tu foto, analizando con IA...');
      
      const mediaUrl = req.body.MediaUrl0;
      const data = await analyzeImageWithClaude(mediaUrl);
      const { mes, grupo } = await saveToSheets(data);

      const montoFmt = data.moneda === 'USD' 
        ? `US$${parseFloat(data.monto).toLocaleString('es-DO')}` 
        : `RD$${parseFloat(data.monto).toLocaleString('es-DO')}`;

      const tipoIcon = data.tipo === 'factura' ? '🧾' : '🏦';
      const ref = data.tipo === 'factura' 
        ? (data.numFactura ? `Factura: ${data.numFactura}` : '') 
        : (data.numTransaccion ? `Transacción: ${data.numTransaccion}` : '');

      await sendWhatsApp(from, 
        `✅ *Gasto registrado en Google Sheets*\n\n` +
        `${tipoIcon} *${data.tipo === 'factura' ? 'Factura' : 'Depósito'}*\n` +
        `📅 Fecha: ${data.fecha} (${mes})\n` +
        `💰 Monto: ${montoFmt}\n` +
        `🏷️ Categoría: ${data.categoria}\n` +
        `📂 Grupo: ${grupo}\n` +
        `🏪 Proveedor: ${data.proveedor}\n` +
        `📝 Descripción: ${data.descripcion}\n` +
        `${ref ? `🔢 ${ref}\n` : ''}` +
        `\n_Si algo está incorrecto, responde con la corrección._`
      );

    } else if (body) {
      await sendWhatsApp(from, 
        '🥑 *Bot Finca Aguacates*\n\n' +
        'Envíame una foto de tu factura o comprobante de depósito y lo registro automáticamente en Google Sheets.\n\n' +
        '📷 Solo manda la foto y yo me encargo del resto.'
      );
    }
  } catch (err) {
    console.error('Error:', err.message);
    await sendWhatsApp(from, '❌ Hubo un error procesando tu foto. Intenta de nuevo.');
  }
});

app.get('/', (req, res) => res.send('🥑 Finca Bot activo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));
