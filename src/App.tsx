import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Loader2, Image as ImageIcon, Waves, AlertCircle, Printer, MapPin, Utensils, Info } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';

interface DiveAnalysisOrganism {
    nom_commun: string;
    nom_scientifique: string;
    confiance: string;
    observation: string;
    justification: string;
    type: string;
    regne: string;
    famille: string;
    phrase_descriptive: string;
    habitat: string;
    alimentation: string;
}

interface DiveAnalysis {
  vue_ensemble: string;
  organismes: DiveAnalysisOrganism[];
  verification_critique: string;
  synthese: string;
}

const PROMPT = `Analyse cette photo sous-marine comme un biologiste marin, puis transforme le résultat en fiche pédagogique PDF Diving Aware (A4).

⚠️ Objectif prioritaire : 
Identifier les organismes (même avec incertitude), pas seulement décrire la scène.

🔬 1. ANALYSE D’IDENTIFICATION (OBLIGATOIRE)
Pour chaque organisme visible :

👉 Étape 1 : Observation précise
Décris les indices visuels utiles à l’identification :
- forme (allongée, massive, ramifiée…)
- couleur (en tenant compte de la perte des rouges en profondeur)
- comportement (posé, en banc, caché…)
- interaction avec le milieu

👉 Étape 2 : Identification (même partielle)
Tu dois proposer : Nom commun probable ET Nom scientifique probable (genre ou espèce)
⚠️ Tu dois toujours proposer une hypothèse, sauf si totalement impossible → dans ce cas : "je ne sais pas"

👉 Étape 3 : Niveau de confiance
Indique clairement : ✅ Élevé, ⚠️ Moyen, ou ❌ Faible

👉 Étape 4 : Justification
Explique en 1–2 phrases pourquoi tu proposes cette identification.

🌿 2. CLASSIFICATION BIOLOGIQUE
Pour chaque organisme : Type (poisson, corail, algue…), Règne (animal/végétal/autre), Famille ou groupe.

🌍 3. ÉCOLOGIE (OBLIGATOIRE)
Pour chaque organisme :
👉 Lieu de vie : habitat (récif, sable...), position, zone géographique probable (et insérer dans la phrase descriptive du type : "(Nom scientifique) est une espèce largement répandue dans...").
👉 Mode de vie / alimentation : carnivore / herbivore / filtreur / photosynthèse, etc.

🧠 4. VÉRIFICATION CRITIQUE
Vérifie la cohérence forme + habitat + comportement et signale toute incohérence éventuelle.

📄 5. GÉNÉRATION DE LA FICHE PDF
Structure les données pour remplir l'interface utilisateur Diving Aware avec la vue d'ensemble, la liste des organismes (avec leur bloc détaillé d'identification et écologie), la vérification critique et la synthèse pédagogique contenant le message clé.`;

export default function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DiveAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextText, setContextText] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordAttempt, setPasswordAttempt] = useState('');
  const [fallbackApiKey, setFallbackApiKey] = useState('');
  const [showFallbackInput, setShowFallbackInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if already authenticated in local storage
    const authStatus = localStorage.getItem('diving_aware_auth');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }

    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordAttempt.toUpperCase() === 'AWARE2024') {
      setIsAuthenticated(true);
      localStorage.setItem('diving_aware_auth', 'true');
      setError(null);
    } else {
      setError('Mot de passe incorrect.');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('diving_aware_auth');
    setResult(null);
    setImageFile(null);
    setImagePreview(null);
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Veuillez sélectionner une image valide.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setError(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const analyzeImage = async () => {
    if (!imageFile) return;

    try {
      setIsAnalyzing(true);
      setResult(null);
      setError(null);

      const apiKey = fallbackApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setShowFallbackInput(true);
        throw new Error("Erreur: Clé API manquante. Veuillez entrer une clé de test ci-dessous.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const base64Data = await fileToBase64(imageFile);

      const imagePart = {
        inlineData: {
          mimeType: imageFile.type,
          data: base64Data,
        },
      };
      
      let fullPrompt = PROMPT;
      if (contextText.trim()) {
        fullPrompt += `\n\nContexte ou notes du plongeur : ${contextText}`;
      }
      
      const textPart = {
        text: fullPrompt,
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: { parts: [imagePart, textPart] },
        config: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              vue_ensemble: { type: Type.STRING, description: "2-3 phrases sur la vue d'ensemble (fond, profondeur, ambiance)" },
              organismes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "Type (poisson, corail, etc.)" },
                    regne: { type: Type.STRING, description: "animal / végétal / autre" },
                    famille: { type: Type.STRING, description: "Famille ou groupe biologique" },
                    nom_commun: { type: Type.STRING, description: "Nom commun ou 'je ne sais pas'" },
                    nom_scientifique: { type: Type.STRING, description: "Nom scientifique ou 'je ne sais pas'" },
                    confiance: { type: Type.STRING, description: "Niveau de confiance: ✅ Élevé, ⚠️ Moyen ou ❌ Faible" },
                    observation: { type: Type.STRING, description: "Indices visuels: forme, couleur, comportement" },
                    justification: { type: Type.STRING, description: "Pourquoi l'identification est proposée (1-2 phrases)" },
                    phrase_descriptive: { type: Type.STRING, description: "Ex: (Nom scientifique), aussi appelé (nom commun), est une espèce que l'on trouve dans..." },
                    habitat: { type: Type.STRING, description: "Lieu de vie (sable, récif, pleine eau, etc.)" },
                    alimentation: { type: Type.STRING, description: "prédateur / herbivore / filtreur / photosynthèse, etc." }
                  }
                }
              },
              verification_critique: { type: Type.STRING, description: "Vérification de la cohérence forme/habitat/comportement avec signalement d'incohérences si besoin" },
              synthese: { type: Type.STRING, description: "Synthèse pédagogique et message clé plongeur" }
            },
            required: ["vue_ensemble", "organismes", "verification_critique", "synthese"]
          }
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text) as DiveAnalysis;
        setResult(data);
      } else {
        throw new Error("Format de réponse invalide.");
      }
    } catch (err: any) {
      console.error(err);
      let errorMessage = err.message || "Une erreur est survenue lors de l'analyse.";
      
      // Intercept quota / region errors from Google API ONLY if we are using the server key
      if (!fallbackApiKey && (errorMessage.includes('429') || errorMessage.includes('limit: 0') || errorMessage.includes('RESOURCE_EXHAUSTED'))) {
        errorMessage = "Service indisponible via le serveur (Erreur de Quota Google Europe). Pour tester, veuillez utiliser le champ de clé API manuelle apparu ci-dessous.";
        setShowFallbackInput(true);
      } else if (!fallbackApiKey && errorMessage.includes('503')) {
        errorMessage = "Les serveurs de Google sont actuellement surchargés. Veuillez réessayer dans quelques instants.";
      }
      
      setError(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-200 max-w-md w-full flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-sky-50 flex items-center justify-center mb-6">
            <Waves className="w-10 h-10 text-sky-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Accès Sécurisé</h1>
          <p className="text-slate-500 mb-8">Veuillez entrer le mot de passe pour utiliser le Guide de Plongée AI.</p>
          
          <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
            <input
              type="password"
              placeholder="Mot de passe..."
              value={passwordAttempt}
              onChange={(e) => setPasswordAttempt(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 text-center text-lg font-medium tracking-widest"
              autoFocus
            />
            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
            <button
              type="submit"
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-medium py-4 rounded-xl transition-colors mt-2"
            >
              Accéder à l'outil
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-sky-500/30 print:bg-white print:text-black">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-100/50 via-slate-50 to-slate-50 pointer-events-none print:hidden" />
      
      <div className="relative max-w-[1400px] mx-auto px-6 py-12 flex flex-col xl:flex-row gap-12 print:p-0 print:m-0 print:block">
        {/* Left Column: UI & Inputs */}
        <div className="w-full xl:w-[420px] shrink-0 flex flex-col gap-8 print:hidden">
          <header className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-lg shadow-sky-900/20 overflow-hidden border border-slate-200">
                {/* Le logo devra être placé dans le dossier public/logo.png */}
                <img src="/logo.png" alt="Diving Aware Logo" className="w-full h-full object-contain p-1" onError={(e) => {
                  // Fallback icon si l'image n'est pas encore uploadée
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }} />
                <Waves className="w-8 h-8 text-sky-800 hidden" />
              </div>
              <button onClick={handleLogout} className="text-xs font-semibold text-slate-400 hover:text-slate-600 underline underline-offset-4 px-2 py-1">
                Déconnexion
              </button>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">Guide de Plongée Diving Aware</h1>
              <p className="text-slate-600 text-sm leading-relaxed">
                Charge une photo sous-marine. Notre IA générera une fiche pédagogique imprimable pour débutants.
              </p>
            </div>
          </header>

          <div 
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => !imagePreview && fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-3xl overflow-hidden transition-all duration-300
              ${isDragging ? 'border-sky-400 bg-sky-50' : 'border-slate-300 hover:border-sky-300 hover:bg-slate-50 shadow-sm bg-white'}
              ${imagePreview ? 'border-none ring-1 ring-black/5 bg-black/5' : 'cursor-pointer'}
              flex flex-col items-center justify-center aspect-[4/3]
            `}
          >
            <input 
              type="file" 
              accept="image/*" 
              className="hidden" 
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
              }}
            />

            {imagePreview ? (
              <div className="relative w-full h-full group">
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="w-full h-full object-cover" 
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="bg-white hover:bg-slate-50 shadow-lg px-6 py-3 rounded-full text-slate-800 font-medium flex items-center gap-2 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Changer l'image
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center p-6">
                <div className="w-16 h-16 rounded-full bg-sky-50 flex items-center justify-center mb-4 text-sky-600">
                  <ImageIcon className="w-8 h-8" />
                </div>
                <p className="text-slate-700 font-medium mb-1">Cliquer ou glisser une photo</p>
                <p className="text-slate-500 text-xs">JPG, PNG jusqu'à 10MB</p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="context" className="block text-sm font-medium text-slate-700 mb-2">
              Indices ou remarques pour l'IA (optionnel)
            </label>
            <input
              type="text"
              id="context"
              placeholder="Ex: Le truc noir est une bonellie..."
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              className="w-full bg-white shadow-sm border border-slate-300 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={analyzeImage}
              disabled={!imageFile || isAnalyzing}
              className={`
                flex-1 py-4 rounded-2xl font-medium tracking-wide flex items-center justify-center gap-3 transition-all
                ${!imageFile 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : isAnalyzing 
                    ? 'bg-sky-500 text-white cursor-wait opacity-80'
                    : 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40 hover:-translate-y-0.5'}
              `}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5" />
                  Générer la Fiche
                </>
              )}
            </button>
            {result && (
              <button
                onClick={handlePrint}
                className="py-4 px-6 rounded-2xl font-medium tracking-wide bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center justify-center transition-all shadow-sm"
                title="Imprimer / Exporter en PDF"
              >
                <Printer className="w-5 h-5" />
              </button>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 mt-4 text-red-600">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {showFallbackInput && (
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl mt-4">
              <label htmlFor="fallbackKey" className="block text-sm font-bold text-orange-800 mb-2">
                Mode Test : Entrez votre propre clé API Google
              </label>
              <input
                type="password"
                id="fallbackKey"
                placeholder="AIzaSy..."
                value={fallbackApiKey}
                onChange={(e) => setFallbackApiKey(e.target.value)}
                className="w-full bg-white border border-orange-300 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/50 text-sm mb-2"
              />
              <p className="text-xs text-orange-700">Cette clé ne sera pas sauvegardée et ne sert qu'à contourner le blocage européen de Vercel pour vos tests actuels.</p>
            </div>
          )}
        </div>

        {/* Right Column: PDF Preview Area */}
        <div className="flex-1 flex justify-center items-start print:block print:w-full">
          {!result && !isAnalyzing ? (
            <div className="flex-1 bg-white border border-slate-200 shadow-xl rounded-[32px] p-6 lg:p-12 min-h-[500px] flex flex-col items-center justify-center text-slate-500 text-center print:hidden">
              <Waves className="w-16 h-16 mb-4 text-slate-200" />
              <p className="text-lg font-medium text-slate-600 mb-2">Prêt pour la plongée !</p>
              <p className="max-w-xs text-sm">Télécharge une image et je formaterai une belle fiche A4 prête à imprimer.</p>
            </div>
          ) : result && imagePreview ? (
            /* A4 PAGE RENDER */
            <div className="bg-white text-slate-800 shadow-2xl w-full max-w-[210mm] min-h-[297mm] p-[10mm] sm:p-[15mm] md:p-[20mm] mx-auto print:max-w-none print:w-full print:p-0 print:shadow-none print:ring-0 flex flex-col">
              
              {/* Header */}
              <div className="flex items-center gap-4 mb-4 pb-4 border-b-2 border-sky-800">
                <div className="w-12 h-12 rounded bg-white flex items-center justify-center shrink-0 overflow-hidden">
                  <img src="/logo.png" alt="Diving Aware Logo" className="w-full h-full object-contain" onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }} />
                  <Waves className="w-6 h-6 text-sky-800 hidden" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-sky-900 tracking-tight flex-1 font-serif uppercase">
                  Observer pour comprendre – Fiche Diving Aware
                </h1>
              </div>

              {/* Photo */}
              <div className="w-full h-[200px] sm:h-[300px] md:h-[400px] bg-slate-100 rounded-lg overflow-hidden mb-8 border border-slate-200">
                <img 
                  src={imagePreview} 
                  alt="Scène centrale" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="grid grid-cols-1 gap-8 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-sky-800 mb-2 uppercase tracking-wide border-l-4 border-sky-400 pl-3">Vue d'ensemble</h2>
                  <p className="text-sm leading-relaxed text-slate-700">{result.vue_ensemble}</p>
                </div>
              </div>

              {/* Fiches Organismes */}
              <div className="mb-8">
                <h2 className="text-lg font-bold text-sky-800 mb-4 uppercase tracking-wide border-l-4 border-sky-400 pl-3 flex items-center gap-2">
                  <Info className="w-5 h-5 text-sky-600" />
                  Identification Biologique
                </h2>
                <div className="grid grid-cols-1 gap-6">
                  {result.organismes.map((org, index) => (
                    <div key={index} className="bg-sky-50/30 border border-sky-100 p-5 rounded-2xl flex flex-col gap-3">
                      
                      {/* Entête organisme */}
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-slate-900 capitalize text-lg">{org.nom_commun}</h3>
                            <span className="text-[12px] uppercase font-bold text-sky-800 bg-sky-200 px-2 py-0.5 rounded-full shadow-sm">
                              {org.type}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 italic font-serif">
                            {org.nom_scientifique} 
                            <span className="ml-2 text-xs not-italic font-sans text-sky-600 font-medium">({org.famille})</span>
                          </p>
                        </div>
                        <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 shadow-sm whitespace-nowrap">
                          Confiance : {org.confiance}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Bloc Analyse */}
                        <div className="bg-white p-3 rounded-xl border border-sky-50 shadow-sm">
                          <p className="text-xs font-bold text-sky-900 mb-1 uppercase tracking-wider">🔬 Analyse Visuelle</p>
                          <p className="text-xs leading-relaxed text-slate-600 mb-3">{org.observation}</p>
                          <p className="text-xs font-bold text-sky-900 mb-1 uppercase tracking-wider">⚖️ Justification</p>
                          <p className="text-xs leading-relaxed text-slate-600">{org.justification}</p>
                        </div>

                        {/* Bloc Écologie */}
                        <div className="flex flex-col gap-3">
                          <p className="text-xs text-sky-900 font-semibold bg-white border border-sky-100 py-1.5 px-3 rounded-lg w-max">
                            Règne : {org.regne}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-700 italic border-l-2 border-sky-300 pl-3">"{org.phrase_descriptive}"</p>
                          <div className="flex flex-col gap-2 mt-auto text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-sky-500 shrink-0" />
                              <span><strong>Habitat :</strong> {org.habitat}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Utensils className="w-4 h-4 text-sky-500 shrink-0" />
                              <span><strong>Alimentation :</strong> {org.alimentation}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  ))}
                  {result.organismes.length === 0 && (
                    <p className="text-sm text-slate-500 italic p-4">Aucun organisme spécifiquement identifié dans l'image.</p>
                  )}
                </div>
              </div>

              {/* Vérification Critique & Synthèse */}
              <div className="mt-auto grid grid-cols-1 gap-6 bg-slate-50 border border-slate-200 p-6 rounded-2xl mb-6">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <span className="text-sky-600 text-lg">💡</span> Vérification Critique
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-700">{result.verification_critique}</p>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <h2 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <span className="text-sky-600 text-lg">🎯</span> Synthèse
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-700">{result.synthese}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 border border-slate-200 rounded-xl p-4 bg-sky-50 text-xs">
                 <p className="font-bold text-sky-900 mb-1">Différence animal / végétal :</p>
                 <ul className="list-disc list-inside text-slate-700 ml-1 space-y-0.5">
                   <li><strong>Animal :</strong> mange de la nourriture, parfois bouge.</li>
                   <li><strong>Végétal / algue :</strong> utilise la lumière (photosynthèse).</li>
                 </ul>
              </div>

              {/* Message Impact */}
              <div className="mt-6 text-center">
                <p className="text-base sm:text-lg font-serif italic text-sky-800 font-medium px-4 py-3 bg-sky-50/50 rounded-lg inline-block border border-sky-100">
                  "Sous l'eau, ce qui semble immobile est souvent vivant."
                </p>
              </div>

              {/* Footer Logo & URL */}
              <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-slate-400">
                <span className="text-xs tracking-widest uppercase font-semibold">Diving Aware ©</span>
                <span className="text-xs font-medium">www.diving-aware.com</span>
              </div>

            </div>
          ) : (
            <div className="flex-1 bg-white shadow-2xl rounded-[32px] p-12 min-h-[500px] flex flex-col items-center justify-center text-slate-500 print:hidden">
              <Loader2 className="w-16 h-16 mb-4 text-cyan-600 animate-spin" />
              <p className="text-lg font-medium text-slate-600 mb-2">Création de la fiche A4...</p>
              <p className="text-sm">Veuillez patienter pendant l'analyse de l'image.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
