import express from 'express';
import serverless from 'serverless-http';
import nodemailer from 'nodemailer';
import { getStore } from '@netlify/blobs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json({ limit: '10kb' }));

function esCorreoValido(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}


const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Cabecera x-api-key faltante o invalida.'
    });
  }
  next();
};


router.get('/time', (req, res) => {
  const now = new Date();
  return res.status(200).json({
    status: 'success',
    data: {
      serverTimeISO: now.toISOString(),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      formatted: now.toUTCString(),
      platform: 'Netlify Functions (AWS Lambda)'
    }
  });
});


router.post('/send-email', requireApiKey, async (req, res) => {
  try {
    const { to, subject, message, senderName } = req.body;

    if (!to || !subject || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Parametros obligatorios faltantes: to, subject y message son requeridos.'
      });
    }

    if (!esCorreoValido(to)) {
      return res.status(400).json({
        status: 'error',
        message: 'El formato de correo en el campo "to" no es valido.'
      });
    }


    const sanitizedSubject = subject.replace(/[\r\n]+/g, '');
    
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.status(500).json({
        status: 'error',
        message: 'Servicio de correo no configurado en el servidor.'
      });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    const displayName = senderName ? senderName : 'El Sistema';
    const htmlTemplate = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px; background-color: #f9f9f9;">
        <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">Notificación de API Serverless</h2>
        <p style="font-size: 16px; color: #333; line-height: 1.5;">Hola,</p>
        <p style="font-size: 16px; color: #333; line-height: 1.5;">Has recibido un nuevo mensaje de <strong>${displayName}</strong>:</p>
        <div style="background-color: #fff; padding: 15px; border-left: 4px solid #0056b3; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <p style="margin: 0; font-size: 15px; color: #555;">${message}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888; text-align: center;">
          Este mensaje fue despachado mediante Netlify Express API Serverless a las ${new Date().toUTCString()}
        </p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: EMAIL_FROM || `"API Serverless" <${SMTP_USER}>`,
      to,
      subject: sanitizedSubject,
      text: message,
      html: htmlTemplate
    });

    return res.status(200).json({
      status: 'success',
      message: 'Correo despachado satisfactoriamente.',
      data: {
        messageId: info.messageId,
        recipient: to
      }
    });

  } catch (error) {
    console.error('Error al procesar envio de correo:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al despachar el correo.',
      details: error.message
    });
  }
});

const MAX_EVENTOS_ESCANEO = 5000;
const LIMITE_RECIENTES = 50;

function obtenerAlmacenMetricas() {
  return getStore({
    name: 'funnel-metrics',
    consistency: 'strong'
  });
}

async function cargarEventos({ step, source } = {}) {
  const store = obtenerAlmacenMetricas();
  const { blobs } = await store.list({ prefix: 'metric_' });

  const claves = blobs
    .map((b) => b.key)
    .sort()
    .reverse()
    .slice(0, MAX_EVENTOS_ESCANEO);

  const eventos = [];
  const TAMANO_LOTE = 50;
  for (let i = 0; i < claves.length; i += TAMANO_LOTE) {
    const lote = await Promise.all(
      claves.slice(i, i + TAMANO_LOTE).map((k) => store.get(k, { type: 'json' }))
    );
    eventos.push(...lote.filter(Boolean));
  }

  const stepFiltro = step ? String(step).toLowerCase().trim() : null;
  const sourceFiltro = source ? String(source).toLowerCase().trim() : null;

  const filtrados = eventos.filter(
    (e) =>
      (!stepFiltro || e.step === stepFiltro) &&
      (!sourceFiltro || e.source === sourceFiltro)
  );

  return {
    eventos: filtrados,
    totalAlmacenado: blobs.length,
    truncado: blobs.length > MAX_EVENTOS_ESCANEO
  };
}

function resumir(eventos) {
  const summary = { totalEvents: eventos.length, byStep: {}, bySource: {} };
  for (const e of eventos) {
    summary.byStep[e.step] = (summary.byStep[e.step] || 0) + 1;
    summary.bySource[e.source] = (summary.bySource[e.source] || 0) + 1;
  }
  return summary;
}

function celdaCSV(valor) {
  let texto = valor === undefined || valor === null ? '' : String(valor);
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}


router.post('/metrics', async (req, res) => {
  try {
    const { step, source, sessionId, metadata } = req.body || {};

    // 1. Validación defensiva
    if (!step || !source || !String(step).trim() || !String(source).trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" son obligatorios.'
      });
    }

    if (String(step).length > 50 || String(source).length > 50) {
      return res.status(400).json({
        status: 'error',
        message: 'Los campos "step" y "source" admiten máximo 50 caracteres.'
      });
    }

    if (
      metadata !== undefined &&
      (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    ) {
      return res.status(400).json({
        status: 'error',
        message: 'El campo "metadata" debe ser un objeto JSON.'
      });
    }

    if (metadata && JSON.stringify(metadata).length > 2000) {
      return res.status(400).json({
        status: 'error',
        message: 'El campo "metadata" excede el tamaño permitido (2000 caracteres).'
      });
    }

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const eventId = `metric_${Date.now()}_${randomSuffix}`;
    const timestamp = new Date().toISOString();

    const metricRecord = {
      id: eventId,
      step: String(step).toLowerCase().trim(),
      source: String(source).toLowerCase().trim(),
      sessionId: sessionId ? String(sessionId).slice(0, 100) : 'anon_guest',
      metadata: metadata || {},
      timestamp
    };

    const store = obtenerAlmacenMetricas();
    await store.setJSON(eventId, metricRecord);

    return res.status(201).json({
      status: 'success',
      message: 'Métrica persistida correctamente en Netlify Blobs.',
      data: metricRecord
    });
  } catch (error) {
    console.error('Error al registrar métrica:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al persistir la métrica.',
      details: error.message
    });
  }
});

router.get('/metrics/export', async (req, res) => {
  try {
    const { format = 'csv', step, source } = req.query;

    if (String(format).toLowerCase() !== 'csv') {
      return res.status(400).json({
        status: 'error',
        message: 'Formato no soportado. Usa ?format=csv.'
      });
    }

    const { eventos } = await cargarEventos({ step, source });

    const columnas = ['id', 'step', 'source', 'sessionId', 'timestamp'];
    const filas = eventos.map((e) => columnas.map((c) => celdaCSV(e[c])).join(','));
    const csv = '\ufeff' + [columnas.join(','), ...filas].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="metricas_funnel.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Error al exportar métricas:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al exportar métricas.',
      details: error.message
    });
  }
});

router.get('/metrics', async (req, res) => {
  try {
    const { step, source } = req.query;
    const { eventos, totalAlmacenado, truncado } = await cargarEventos({ step, source });

    return res.status(200).json({
      status: 'success',
      data: {
        filters: { step: step || null, source: source || null },
        summary: resumir(eventos),
        recentEvents: eventos.slice(0, LIMITE_RECIENTES),
        meta: { totalStored: totalAlmacenado, truncated: truncado }
      }
    });
  } catch (error) {
    console.error('Error al consultar métricas:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al consultar métricas en Netlify Blobs.',
      details: error.message
    });
  }
});

app.use('/api', router);


app.use((err, req, res, next) => {
  const status = err.status || 500;
  return res.status(status).json({
    status: 'error',
    message: status === 413 ? 'Payload demasiado grande.' : 'Solicitud invalida.'
  });
});

export const handler = serverless(app);