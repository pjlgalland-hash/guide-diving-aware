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

const PROMPT = `Analyse cette photo sous-marine comme un biologiste marin et génère une fiche pédagogique Diving Aware (A4).

⚠️ IMPORTANT : Génère tout le contenu (labels, descriptions, titres, tout) dans la langue demandée par l'utilisateur.

Objectif : Identifier les organismes (même avec incertitude), pas seulement décrire la scène.

1. ANALYSE D’IDENTIFICATION
Pour chaque organisme visible :
- Observation : indices visuels (forme, couleur, comportement).
- Identification : Nom commun probable, Nom scientifique probable.
- Confiance : Élevé / Moyen / Faible
- Justification : 1-2 phrases.

2. CLASSIFICATION BIOLOGIQUE
Type (poisson, corail, etc.), Règne, Famille.

3. ÉCOLOGIE
Habitat, Mode de vie / alimentation.

4. VÉRIFICATION CRITIQUE
Cohérence forme/habitat/comportement.

5. SYNTHÈSE
Synthèse pédagogique et message clé.`;

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
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
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

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Erreur: Clé API manquante dans la configuration du serveur (Vercel).");
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
      fullPrompt += `\n\nRéponds exclusivement en ${language === 'fr' ? 'français' : 'anglais'}.`;
      if (contextText.trim()) {
        fullPrompt += `\n\nContexte ou notes du plongeur : ${contextText}`;
      }
      
      const textPart = {
        text: fullPrompt,
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
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
      
      // Intercept quota / region errors from Google API
      if (errorMessage.includes('429') || errorMessage.includes('limit: 0') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        errorMessage = "Service temporairement indisponible (Quota Google atteint). Veuillez réessayer plus tard.";
      } else if (errorMessage.includes('503')) {
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
          <div className="w-48 h-32 flex items-center justify-center mb-6 overflow-hidden">
            <img 
              src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
              alt="Diving Aware Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Accès Sécurisé</h1>
          <p className="text-sky-600 text-xs font-bold uppercase tracking-widest mb-6">Le souffle de l'eau</p>
          <p className="text-slate-500 mb-8">Veuillez entrer le mot de passe pour utiliser le Guide de Plongée AI.</p>
          
          <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
            <input
              type="password"
              placeholder="Mot de passe..."
              value={passwordAttempt}
              onChange={(e) => setPasswordAttempt(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-4 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003466]/20 focus:border-[#003466] text-center text-lg font-medium tracking-widest"
              autoFocus
            />
            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
            <button
              type="submit"
              className="w-full bg-[#003466] hover:bg-[#00284d] text-white font-bold uppercase tracking-wider py-4 rounded-lg transition-all shadow-md active:scale-[0.98]"
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
              <div className="w-56 h-36 flex items-center justify-start overflow-hidden">
                <img 
                  src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
                  alt="Diving Aware Logo" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <button onClick={handleLogout} className="text-xs font-semibold text-slate-400 hover:text-slate-600 underline underline-offset-4 px-2 py-1 mt-4">
                Déconnexion
              </button>
            </div>
            <div>
              <div className="flex flex-col gap-1 mb-4 mt-[-10px]">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Guide de Plongée</h1>
                <p className="text-[#003466] text-xs font-bold uppercase tracking-[0.2em] opacity-60">Diving Aware</p>
              </div>
              <div className="bg-white/80 backdrop-blur-sm border-l-[6px] border-[#003466] p-6 shadow-sm rounded-r-2xl mb-8">
                <p className="text-slate-700 text-[15px] leading-relaxed italic font-serif">
                  "Diving Aware est un compagnon de palanquée intelligent conçu pour les plongeurs conscients. En analysant vos clichés, il vous aide à identifier la biodiversité rencontrée et transforme vos observations en fiches pédagogiques détaillées. Un outil pour apprendre, respecter et partager la fragilité du monde sous-marin."
                </p>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed px-1">
                Chargez une photo sous-marine ci-dessous pour initier l'analyse biologique.
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
            <label className="block text-sm font-medium text-slate-700 mb-2">Langue de la fiche</label>
            <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
              <button
                onClick={() => setLanguage('fr')}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded ${language === 'fr' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Français
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded ${language === 'en' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                English
              </button>
            </div>
            
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

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={analyzeImage}
              disabled={!imageFile || isAnalyzing}
              className={`
                flex-1 py-4 px-8 rounded-lg font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all
                ${!imageFile 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : isAnalyzing 
                    ? 'bg-slate-800 text-white cursor-wait opacity-80'
                    : 'bg-[#003466] text-white hover:bg-[#00284d] active:scale-[0.98] shadow-md'}
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
                className="py-4 px-8 rounded-lg font-bold uppercase tracking-wider text-sm bg-white border-2 border-[#003466] hover:bg-slate-50 text-[#003466] flex items-center justify-center transition-all shadow-sm"
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
              <div className="flex items-center gap-6 mb-4 pb-4 border-b-2 border-[#003466]">
                <div className="w-24 h-24 flex items-center justify-center shrink-0 overflow-hidden">
                  <img 
                    src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
                    alt="Diving Aware Logo" 
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-[#003466] tracking-tight flex-1 font-serif uppercase">
                  {language === 'fr' ? 'Guide d’identification – Diving Aware' : 'Identification Guide – Diving Aware'}
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
                  <h2 className="text-lg font-bold text-sky-800 mb-2 uppercase tracking-wide border-l-4 border-sky-400 pl-3">
                    {language === 'fr' ? "Vue d'ensemble" : "Overview"}
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-700">{result.vue_ensemble}</p>
                </div>
              </div>

              {/* Fiches Organismes */}
              <div className="mb-8">
                <h2 className="text-lg font-bold text-sky-800 mb-4 uppercase tracking-wide border-l-4 border-sky-400 pl-3 flex items-center gap-2">
                  <Info className="w-5 h-5 text-sky-600" />
                  {language === 'fr' ? "Identification Biologique" : "Biological Identification"}
                </h2>
                <div className="grid grid-cols-1 gap-6">
                  {result.organismes.map((org, index) => (
                    <div key={index} className="bg-sky-50/30 border border-sky-100 p-5 rounded-2xl flex flex-col gap-3">
                      
                      {/* Entête organisme */}
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-slate-900 capitalize text-lg">{org.nom_commun}</h3>
                            <span className="text-[12px] uppercase font-bold text-white bg-[#003466] px-2 py-0.5 rounded shadow-sm">
                              {org.type}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 italic font-serif">
                            {org.nom_scientifique} 
                            <span className="ml-2 text-xs not-italic font-sans text-[#003466] font-medium">({org.famille})</span>
                          </p>
                        </div>
                        <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 shadow-sm whitespace-nowrap">
                          Confiance : {org.confiance}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Bloc Analyse */}
                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                          <p className="text-xs font-bold text-[#003466] mb-1 uppercase tracking-wider">
                            {language === 'fr' ? "🔬 Analyse Visuelle" : "🔬 Visual Analysis"}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-600 mb-3">{org.observation}</p>
                          <p className="text-xs font-bold text-[#003466] mb-1 uppercase tracking-wider">
                            {language === 'fr' ? "⚖️ Justification" : "⚖️ Justification"}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-600">{org.justification}</p>
                        </div>

                        {/* Bloc Écologie */}
                        <div className="flex flex-col gap-3">
                          <p className="text-xs text-white font-bold bg-[#003466] py-1.5 px-3 rounded w-max">
                            {language === 'fr' ? "Règne" : "Kingdom"} : {org.regne}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-700 italic border-l-2 border-[#003466] pl-3">"{org.phrase_descriptive}"</p>
                          <div className="flex flex-col gap-2 mt-auto text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-[#003466] shrink-0" />
                              <span><strong>Habitat :</strong> {org.habitat}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Utensils className="w-4 h-4 text-[#003466] shrink-0" />
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
                    <span className="text-sky-600 text-lg">💡</span> {language === 'fr' ? "Vérification Critique" : "Critical Verification"}
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-700">{result.verification_critique}</p>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <h2 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <span className="text-sky-600 text-lg">🎯</span> {language === 'fr' ? "Synthèse" : "Synthesis"}
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-700">{result.synthese}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 border border-slate-200 rounded-xl p-4 bg-sky-50 text-xs">
                 <p className="font-bold text-sky-900 mb-1">
                   {language === 'fr' ? "Différence animal / végétal :" : "Animal / Plant difference:"}
                 </p>
                 <ul className="list-disc list-inside text-slate-700 ml-1 space-y-0.5">
                   <li><strong>{language === 'fr' ? "Animal" : "Animal"} :</strong> {language === 'fr' ? "mange de la nourriture, parfois bouge." : "eats food, sometimes moves."}</li>
                   <li><strong>{language === 'fr' ? "Végétal / algue" : "Plant / Algae"} :</strong> {language === 'fr' ? "utilise la lumière (photosynthèse)." : "uses light (photosynthesis)."}</li>
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
