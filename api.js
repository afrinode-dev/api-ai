// api.js - Scraping réel de gemini.google.com
const puppeteer = require('puppeteer');

export default async function handler(req, res) {
  // Configuration CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Un seul endpoint: /api/gemini?q=message
  if (req.method === 'GET' || req.method === 'POST') {
    const query = req.method === 'GET' ? req.query.q : req.body?.q;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre "q" requis',
        example: '/api/gemini?q=Bonjour'
      });
    }
    
    try {
      const response = await scrapeGeminiReal(query);
      return res.status(200).json({
        success: true,
        query: query,
        response: response,
        timestamp: new Date().toISOString(),
        source: 'gemini.google.com'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        query: query
      });
    }
  }
  
  return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
}

async function scrapeGeminiReal(query) {
  let browser = null;
  
  try {
    // Lancement de Puppeteer avec les options pour Vercel
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });
    
    const page = await browser.newPage();
    
    // Configuration des headers pour éviter d'être bloqué
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigation vers Gemini
    await page.goto('https://gemini.google.com/u/2/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Attendre le chargement de l'interface
    await page.waitForTimeout(3000);
    
    // Trouver et remplir le champ de texte
    const textareaSelector = 'textarea, [contenteditable="true"], .ql-editor, input[type="text"]';
    await page.waitForSelector(textareaSelector, { timeout: 10000 });
    
    // Saisir la requête
    await page.click(textareaSelector);
    await page.type(textareaSelector, query);
    
    // Trouver et cliquer sur le bouton d'envoi
    const buttonSelectors = [
      'button[aria-label="Envoyer"]',
      'button[aria-label="Send"]',
      'button.send-button',
      '.send-button',
      'button[type="submit"]'
    ];
    
    let buttonClicked = false;
    for (const selector of buttonSelectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        buttonClicked = true;
        break;
      }
    }
    
    if (!buttonClicked) {
      // Alternative: appuyer sur Entrée
      await page.keyboard.press('Enter');
    }
    
    // Attendre la réponse
    await page.waitForTimeout(5000);
    
    // Attendre l'apparition de la réponse
    const responseSelectors = [
      '.message-content',
      '.response-text',
      '.model-response-text',
      '.result-content',
      '[data-message-author-role="model"]',
      '.prose'
    ];
    
    let responseText = '';
    for (const selector of responseSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const element = await page.$(selector);
        if (element) {
          responseText = await page.evaluate(el => el.textContent, element);
          if (responseText && responseText.trim().length > 0) {
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    // Si pas trouvé avec les sélecteurs, récupérer tout le contenu
    if (!responseText || responseText.trim().length === 0) {
      responseText = await page.evaluate(() => {
        const modelMessages = document.querySelectorAll('[data-message-author-role="model"]');
        if (modelMessages.length > 0) {
          return modelMessages[modelMessages.length - 1].innerText;
        }
        return document.body.innerText;
      });
    }
    
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('Aucune réponse reçue de Gemini');
    }
    
    // Nettoyer la réponse
    responseText = responseText.trim();
    
    await browser.close();
    return responseText;
    
  } catch (error) {
    if (browser) await browser.close();
    throw new Error(`Erreur de scraping: ${error.message}`);
  }
}