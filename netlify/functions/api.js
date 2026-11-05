import express from 'express';
import serverless from 'serverless-http';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());

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

app.use('/api', router);

export const handler = serverless(app);