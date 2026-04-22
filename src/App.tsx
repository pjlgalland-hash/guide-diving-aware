import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Loader2, Image as ImageIcon, Waves, AlertCircle, Printer, MapPin, Utensils, Info, Lock, CheckCircle2, Mail, ChevronRight } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { db, auth, googleProvider, UserStats } from './lib/firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { loadStripe } from '@stripe/stripe-js';
import { motion, AnimatePresence } from 'motion/react';

const DAILY_QUOTA_LIMIT = 3;
const ADMIN_EMAIL = 'pjl.galland@gmail.com';
const COLLABORATORS = [
  ADMIN_EMAIL,
  'Py.buri@hotmail.com',
  // Ajoutez les emails de vos collaborateurs ici :
  // 'email2@gmail.com',
  // 'email3@gmail.com'
];

const isTeamMember = (email?: string | null) => email ? COLLABORATORS.includes(email) : false;

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

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

⚠️ IMPORTANT : Génère TOUT le contenu dans la langue demandée par l'utilisateur (Français ou Anglais).
- Traduis TOUS les labels, titres, catégories (y compris 'Type', 'Règne', 'Habitat', 'Alimentation'), et les valeurs (par ex: 'Poisson'/'Fish', 'Éponge'/'Sponge', 'Animal'/'Animal').

Objectif : Identifier les organismes, pas seulement décrire la scène.

1. ANALYSE D’IDENTIFICATION
Pour chaque organisme visible :
- Observation : indices visuels.
- Identification : Nom commun, Nom scientifique.
- Confiance : Élevé / Moyen / Faible (ou High / Medium / Low).
- Justification : 1-2 phrases.

2. CLASSIFICATION BIOLOGIQUE
Type (poisson, corail, etc.), Règne, Famille.

3. ÉCOLOGIE
Habitat, Mode de vie / alimentation.

4. VÉRIFICATION CRITIQUE
Cohérence forme/habitat/comportement.

5. SYNTHÈSE
Synthèse pédagogique et message clé.

6. URL & RÉFÉRENCE
- Sur la fiche pédagogique, tu DOIS TOUJOURS afficher uniquement l'URL : https://diving-aware.com
- Il est strictement INTERDIT d'utiliser ou d'afficher l'URL : guide-diving-aware.vercel.app`;

export default function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<DiveAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextText, setContextText] = useState<string>('');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [user, setUser] = useState<User | null>(null);
  const [userUsage, setUserUsage] = useState<UserStats | null>(null);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'cancel' | null>(null);
  const [showCenterSettings, setShowCenterSettings] = useState(false);
  const [legalView, setLegalView] = useState<'legal' | 'cookies' | 'cgu' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check URL for payment status
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setPaymentStatus('success');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('payment') === 'cancel') {
      setPaymentStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handlePassionneeClick = async () => {
    if (!user) return;
    
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, userEmail: user.email }),
      });
      
      const { id } = await response.json();
      const stripe = await stripePromise;
      if (stripe && id) {
        await stripe.redirectToCheckout({ sessionId: id });
      }
    } catch (error) {
      console.error("Stripe Redirect Error:", error);
      alert("Erreur lors de la redirection vers le paiement. Veuillez vérifier vos clés Stripe.");
    }
  };

  const handleCenterSettingsUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !userUsage) return;
    
    const formData = new FormData(e.currentTarget);
    const centerName = formData.get('centerName') as string;
    const centerLogoUrl = formData.get('centerLogoUrl') as string;

    try {
      const docRef = doc(db, 'users', user.uid, 'stats', 'usage');
      await updateDoc(docRef, { centerName, centerLogoUrl });
      setUserUsage({ ...userUsage, centerName, centerLogoUrl });
      alert(language === 'fr' ? "Paramètres du centre mis à jour !" : "Center settings updated!");
      setShowCenterSettings(false);
    } catch (err) {
      console.error(err);
      alert("Error updating settings");
    }
  };

  useEffect(() => {
    // Handle Magic Link sign-in
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let email = window.localStorage.getItem('emailForSignIn');
      if (!email) {
        email = window.prompt('Veuillez confirmer votre email pour terminer la connexion :');
      }
      if (email) {
        signInWithEmailLink(auth, email, window.location.href)
          .then(() => {
            window.localStorage.removeItem('emailForSignIn');
          })
          .catch((error) => {
            console.error("Erreur lien magique:", error);
            alert("Le lien de connexion a expiré ou a déjà été utilisé.");
          });
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await fetchUserUsage(currentUser.uid);
      } else {
        setUserUsage(null);
        setIsQuotaExceeded(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchUserUsage = async (userId: string) => {
    console.log("Fetching usage for:", userId);
    try {
      const docRef = doc(db, 'users', userId, 'stats', 'usage');
      const docSnap = await getDoc(docRef);
      const today = new Date().toISOString().split('T')[0];

      if (docSnap.exists()) {
        const data = docSnap.data() as UserStats;
        console.log("Usage found:", data);
        
        // If payment was successful, update Firestore (Simplified for now)
        if (paymentStatus === 'success' && !data.isPremium) {
          console.log("Updating to premium...");
          await updateDoc(docRef, { isPremium: true });
          data.isPremium = true;
        }

        if (data.lastAnalysisDate !== today) {
          console.log("New day detected, resetting local count");
          setUserUsage({ ...data, dailyCount: 0, lastAnalysisDate: today });
          setIsQuotaExceeded(false);
        } else {
          setUserUsage(data);
          // Check quota if NOT team and NOT premium
          if (!isTeamMember(auth.currentUser?.email) && !data.isPremium && data.dailyCount >= DAILY_QUOTA_LIMIT) {
            setIsQuotaExceeded(true);
          }
        }
      } else {
        console.log("No usage found, creating initial doc");
        // Success payment but no doc yet
        const isPremium = paymentStatus === 'success';
        const newData: UserStats = { userId, dailyCount: 0, lastAnalysisDate: today, isPremium };
        await setDoc(docRef, newData);
        setUserUsage(newData);
        setIsQuotaExceeded(false);
      }
    } catch (e) {
      console.error("Détails de l'erreur Firestore:", e);
      console.error("Erreur lors de la récupération du quota:", e);
    }
  };

  const incrementUsage = async (userId: string) => {
    if (isTeamMember(auth.currentUser?.email) || userUsage?.isPremium || userUsage?.isDiveCenter) return; 

    try {
      const today = new Date().toISOString().split('T')[0];
      const docRef = doc(db, 'users', userId, 'stats', 'usage');
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data() as UserStats;
        if (data.lastAnalysisDate === today) {
          await updateDoc(docRef, {
            dailyCount: data.dailyCount + 1
          });
          setUserUsage({ ...data, dailyCount: data.dailyCount + 1 });
        } else {
          await updateDoc(docRef, {
            dailyCount: 1,
            lastAnalysisDate: today
          });
          setUserUsage({ ...data, dailyCount: 1, lastAnalysisDate: today });
        }
      } else {
        const newData: UserStats = { userId, dailyCount: 1, lastAnalysisDate: today };
        await setDoc(docRef, newData);
        setUserUsage(newData);
      }
    } catch (e) {
      console.error("Erreur lors de l'incrémentation du quota:", e);
    }
  };

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

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
    if (!imageFile || !user) return;

    if (!isTeamMember(user.email) && !userUsage?.isPremium && !userUsage?.isDiveCenter && userUsage && userUsage.dailyCount >= DAILY_QUOTA_LIMIT && userUsage.lastAnalysisDate === new Date().toISOString().split('T')[0]) {
      setIsQuotaExceeded(true);
      return;
    }

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

      if (response && response.candidates && response.candidates[0]) {
        const data = JSON.parse(response.candidates[0].content.parts[0].text || '{}') as DiveAnalysis;
        setResult(data);
        await incrementUsage(user.uid);
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

  const handleLogout = () => {
    signOut(auth);
    setResult(null);
    setImageFile(null);
    setImagePreview(null);
  };

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [emailForSignIn, setEmailForSignIn] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailForSignIn) return;

    setIsLoggingIn(true);
    const actionCodeSettings = {
      url: window.location.href, // Revenir ici après le clic
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, emailForSignIn, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', emailForSignIn);
      setEmailSent(true);
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'envoi: ${err.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FDFDFD] text-slate-800 font-sans flex items-center justify-center p-6">
        <div className="bg-white p-10 rounded-[48px] shadow-sm border border-slate-100 max-w-md w-full flex flex-col items-center text-center">
          <div className="w-48 h-32 flex items-center justify-center overflow-hidden mb-8">
            <img 
              src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
              alt="Diving Aware Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div className="flex bg-slate-100 p-1 rounded-lg mb-8 w-32">
            <button
              onClick={() => setLanguage('fr')}
              className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${language === 'fr' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              FR
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${language === 'en' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              EN
            </button>
          </div>

          <h2 className="font-display text-4xl font-light text-slate-900 mb-6 leading-[1.1] tracking-tight">
            {language === 'fr' 
              ? <>Identifiez la <b>biodiversité</b> de vos plongées</>
              : <>Identify your dives <b>biodiversity</b></>}
          </h2>
          <p className="text-slate-400 mb-12 text-base leading-relaxed font-light tracking-wide max-w-[280px]">
            {language === 'fr'
              ? 'Connectez-vous pour générer vos fiches d\'identification personnalisées.'
              : 'Sign in to generate your personalized identification guides.'}
          </p>

          {emailSent ? (
            <div className="bg-sky-50 p-8 rounded-[32px] border border-sky-100 text-center space-y-4">
              <div className="w-16 h-16 bg-sky-500 text-white rounded-full flex items-center justify-center mx-auto shadow-lg shadow-sky-200">
                <Mail className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Email envoyé !</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {language === 'fr'
                  ? `Un lien de connexion a été envoyé à ${emailForSignIn}. Vérifiez votre boîte de réception (et vos spams).`
                  : `A sign-in link has been sent to ${emailForSignIn}. Check your inbox (and spam).`}
              </p>
              <button 
                onClick={() => setEmailSent(false)}
                className="text-sky-600 text-sm font-bold hover:underline"
              >
                {language === 'fr' ? 'Utiliser une autre méthode' : 'Use another method'}
              </button>
            </div>
          ) : (
            <div className="space-y-4 w-full">
              {showEmailInput ? (
                <form onSubmit={handleEmailSignIn} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
                  <div className="relative">
                    <input 
                      type="email" 
                      required
                      placeholder={language === 'fr' ? 'Votre adresse email' : 'Your email address'}
                      value={emailForSignIn}
                      onChange={(e) => setEmailForSignIn(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-sky-500/10 focus:border-[#003466] outline-none transition-all font-medium text-lg"
                    />
                    <Mail className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300" />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className={`w-full bg-[#003466] text-white py-4 rounded-2xl font-medium tracking-wide transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-900/10 ${isLoggingIn ? 'opacity-70 cursor-wait' : 'hover:bg-black hover:-translate-y-0.5 active:translate-y-0'}`}
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                    {language === 'fr' ? 'Recevoir mon lien de connexion' : 'Send sign-in link'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setShowEmailInput(false)}
                    className="w-full text-slate-400 text-sm font-bold py-2 hover:text-slate-600 transition-colors"
                  >
                    {language === 'fr' ? 'Annuler' : 'Cancel'}
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isLoggingIn}
                    onClick={async () => {
                      setIsLoggingIn(true);
                      try {
                        await signInWithPopup(auth, googleProvider);
                      } catch (err: any) {
                        console.error("Erreur de connexion:", err);
                        if (err.code === 'auth/popup-blocked') {
                          alert(language === 'fr' 
                            ? "Le pop-up de connexion a été bloqué par votre navigateur. Veuillez autoriser les pop-ups ou essayer d'ouvrir l'application dans un nouvel onglet." 
                            : "The sign-in popup was blocked by your browser. Please allow popups or try opening the app in a new tab.");
                        } else {
                          alert(`Erreur de connexion: ${err.message}`);
                        }
                      } finally {
                        setIsLoggingIn(false);
                      }
                    }}
                    className={`w-full bg-white border border-slate-100 text-slate-600 py-4 rounded-2xl font-medium tracking-wide transition-all flex items-center justify-center gap-3 shadow-sm ${isLoggingIn ? 'opacity-70 cursor-wait' : 'hover:bg-slate-50 hover:border-slate-200 hover:-translate-y-0.5 active:translate-y-0'}`}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.61z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    {language === 'fr' ? 'Continuer avec Google' : 'Continue with Google'}
                  </button>

                  <div className="flex items-center gap-4 my-6 w-full">
                    <div className="h-px bg-slate-100 flex-1"></div>
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{language === 'fr' ? 'OU' : 'OR'}</span>
                    <div className="h-px bg-slate-100 flex-1"></div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowEmailInput(true)}
                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-medium tracking-wide transition-all flex items-center justify-center gap-3 shadow-lg shadow-slate-900/5 hover:bg-black hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <Mail className="w-5 h-5" />
                    {language === 'fr' ? 'Se connecter par email' : 'Sign in with email'}
                  </button>
                </>
              )}
            </div>
          )}
          
          <div className="mt-10 pt-6 border-t border-slate-100 w-full">
            <p className="text-[11px] text-slate-400 mb-4 font-medium uppercase tracking-widest">
              {language === 'fr' 
                ? `Inclus : ${DAILY_QUOTA_LIMIT} analyses / jour` 
                : `Included: ${DAILY_QUOTA_LIMIT} analyses / day`}
            </p>
            <div className="bg-sky-50 p-4 rounded-2xl text-[11px] text-sky-700 leading-normal flex items-start gap-3 text-left">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                {language === 'fr'
                  ? "Si rien ne se passe, ouvrez l'application dans un nouvel onglet via la flèche en haut à droite."
                  : "If nothing happens, open the app in a new tab using the arrow in the top right corner."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-sky-500/30 print:bg-white print:text-black">
      <AnimatePresence>
        {legalView && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto" 
            onClick={() => setLegalView(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-2xl my-auto rounded-[32px] shadow-2xl overflow-hidden flex flex-col relative" 
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] italic">
                  {legalView === 'legal' && (language === 'fr' ? 'Mentions Légales' : 'Legal Notice')}
                  {legalView === 'cookies' && (language === 'fr' ? 'Gestion des Cookies' : 'Cookie Policy')}
                  {legalView === 'cgu' && (language === 'fr' ? 'Conditions Générales d’Utilisation' : 'Terms of Use')}
                </h2>
                <button 
                  type="button"
                  onClick={() => setLegalView(null)} 
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 text-xl font-bold leading-none"
                >
                  ×
                </button>
              </div>
              
              <div className="p-8 overflow-y-auto text-slate-600 text-sm leading-relaxed">
                {legalView === 'legal' && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">1. Éditeur du site</h3>
                      <p>Diving Aware est un projet de Philippe Galland. Pour toute demande : pjl.galland@gmail.com.</p>
                    </section>
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">2. Hébergement</h3>
                      <p>Ce service est hébergé sur Google Cloud Run (Europe-West).</p>
                    </section>
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">3. Propriété Intellectuelle</h3>
                      <p>Tous les éléments du site (textes, images, logos, structure du rapport PDF) sont protégés par le droit d'auteur. Toute reproduction sans accord écrit est formellement interdite.</p>
                    </section>
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">4. Responsabilité</h3>
                      <p>L'IA utilisée pour l'identification peut commettre des erreurs. Les informations fournies sont à titre éducatif et ne doivent pas remplacer la consultation de professionnels de la plongée.</p>
                    </section>
                  </div>
                )}
                
                {legalView === 'cookies' && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">Utilisation des cookies</h3>
                      <p>Nous utilisons exclusivement des cookies techniques nécessaires :</p>
                      <ul className="list-disc pl-5 mt-2 space-y-2">
                        <li><strong>Authentification</strong> : Session Google.</li>
                        <li><strong>Préférences</strong> : Choix de la langue (FR/EN).</li>
                        <li><strong>Paiements</strong> : Sécurisation via Stripe.</li>
                      </ul>
                      <p className="mt-4">Aucun cookie de traçage publicitaire n'est déposé par Driving Aware.</p>
                    </section>
                  </div>
                )}

                {legalView === 'cgu' && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">1. Objet du Service</h3>
                      <p>Diving Aware est un outil d'aide à l'identification de la biodiversité marine utilisant l'intelligence artificielle.</p>
                    </section>
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">2. Accès et Quotas</h3>
                      <p>L'offre gratuite est limitée à 3 analyses par jour glissant. Les offres payantes (Passionnée et Centre) permettent une utilisation étendue conformément aux descriptifs lors de l'achat.</p>
                    </section>
                    <section>
                      <h3 className="text-slate-900 font-bold text-base mb-2">3. Éthique et Environnement</h3>
                      <p>L'utilisateur s'engage à respecter le milieu marin : aucun contact physique avec la faune et la flore, respect des distances de sécurité.</p>
                    </section>
                  </div>
                )}
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  type="button"
                  onClick={() => setLegalView(null)}
                  className="bg-[#003466] text-white px-8 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider hover:bg-black transition-all shadow-lg active:scale-95"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-100/50 via-slate-50 to-slate-50 pointer-events-none print:hidden" />
      
      <div className="relative max-w-[1400px] mx-auto px-6 py-12 flex flex-col xl:flex-row gap-12 print:p-0 print:m-0 print:block">
        {/* Left Column: UI & Inputs */}
        <div className="w-full xl:w-[420px] shrink-0 flex flex-col gap-8 print:hidden">
          <header className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div className="flex flex-col items-start gap-2">
                <div className="w-56 h-36 flex items-center justify-start overflow-hidden">
                  <img 
                    src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
                    alt="Diving Aware Logo" 
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="w-full max-w-[200px]">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">{language === 'fr' ? 'Langue de la fiche' : 'Report language'}</label>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                      onClick={() => setLanguage('fr')}
                      className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all ${language === 'fr' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Français
                    </button>
                    <button
                      onClick={() => setLanguage('en')}
                      className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all ${language === 'en' ? 'bg-[#003466] text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} className="text-xs font-semibold text-slate-400 hover:text-slate-600 underline underline-offset-4 px-2 py-1">
                {language === 'fr' ? 'Déconnexion' : 'Logout'}
              </button>
            </div>
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex flex-col gap-1 mt-[-10px]">
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{language === 'fr' ? 'Guide de Plongée' : 'Diving Guide'}</h1>
                  <p className="text-[#003466] text-xs font-bold uppercase tracking-[0.2em] opacity-60">Diving Aware</p>
                </div>
                {!isTeamMember(user.email) && !userUsage?.isPremium && (
                  <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {DAILY_QUOTA_LIMIT - (userUsage?.dailyCount || 0)} {language === 'fr' ? 'restants' : 'left'}
                    </span>
                  </div>
                )}
                {(isTeamMember(user.email) || userUsage?.isPremium || userUsage?.isDiveCenter) && (
                  <div className="bg-sky-100 border border-sky-200 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                    <CheckCircle2 className="w-3 h-3 text-sky-700" />
                    <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">
                      {isTeamMember(user.email) 
                        ? (language === 'fr' ? 'Accès Équipe Illimité' : 'Unlimited Team Access')
                        : userUsage?.isDiveCenter 
                          ? (language === 'fr' ? 'Offre Centre de Plongée' : 'Dive Center Plan')
                          : (language === 'fr' ? 'Offre Passionnée Active' : 'Premium Plan Active')}
                    </span>
                  </div>
                )}
              </div>
              <div className="bg-white/80 backdrop-blur-sm border-l-[6px] border-[#003466] p-6 shadow-sm rounded-r-2xl mb-8">
                <p className="text-slate-700 text-[15px] leading-relaxed italic font-serif">
                  {language === 'fr' 
                    ? '"Diving Aware est un compagnon de palanquée intelligent conçu pour les plongeurs conscients. En analysant vos clichés, il vous aide à identifier la biodiversité rencontrée et transforme vos observations en fiches pédagogiques détaillées. Un outil pour apprendre, respecter et partager la fragilité du monde sous-marin."'
                    : '"Diving Aware is an intelligent buddy designed for mindful divers. By analyzing your snapshots, it helps you identify the biodiversity encountered and transforms your observations into detailed educational fact sheets. A tool to learn, respect, and share the fragility of the underwater world."'}
                </p>
              </div>
              <p className="text-slate-500 text-sm leading-relaxed px-1">
                {language === 'fr' ? "Chargez une photo sous-marine ci-dessous pour initier l'analyse biologique." : "Upload an underwater photo below to initiate biological analysis."}
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
                    {language === 'fr' ? "Changer l'image" : "Change image"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center text-center p-6">
                <div className="w-16 h-16 rounded-full bg-sky-50 flex items-center justify-center mb-4 text-sky-600">
                  <ImageIcon className="w-8 h-8" />
                </div>
                <p className="text-slate-700 font-medium mb-1">{language === 'fr' ? 'Cliquer ou glisser une photo' : 'Click or drop a photo'}</p>
                <p className="text-slate-500 text-xs">JPG, PNG {language === 'fr' ? "jusqu'à" : 'up to'} 10MB</p>
              </div>
            )}
          </div>

          <div>
            
            <label htmlFor="context" className="block text-sm font-medium text-slate-700 mb-2">
              {language === 'fr' ? "Indices ou remarques pour l'IA (optionnel)" : "Clues or remarks for the AI (optional)"}
            </label>
            <input
              type="text"
              id="context"
              placeholder={language === 'fr' ? "Ex: Le truc noir est une bonellie..." : "Ex: The black thing is a bonellia..."}
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              className="w-full bg-white shadow-sm border border-slate-300 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {isQuotaExceeded && (
              <div className="w-full mb-6 bg-white border-2 border-amber-200 rounded-[32px] p-6 sm:p-8 shadow-xl shadow-amber-900/5 flex flex-col items-center gap-6 text-center animate-in fade-in zoom-in duration-500">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                  <Lock className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {language === 'fr' ? 'Quota quotidien atteint' : 'Daily quota reached'}
                  </h3>
                  <p className="text-slate-600 mt-2 text-sm leading-relaxed">
                    {language === 'fr' 
                      ? "Vous appréciez Diving Aware ? Pour continuer à analyser vos photos sans limite aujourd'hui, passez à l'offre supérieure." 
                      : "Enjoying Diving Aware? To keep analyzing your photos without limits today, upgrade your plan."}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 w-full">
                  {/* Offre Passionnée */}
                  <div className="bg-gradient-to-br from-sky-50 to-white border border-sky-100 rounded-2xl p-5 flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="bg-sky-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">OFFRE</span>
                      <span className="font-bold text-sky-900 italic">Passionnée</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {language === 'fr' ? "Analyses illimitées • Accès PRIORITAIRE" : "Unlimited analyses • PRIORITY access"}
                    </p>
                    <button 
                      onClick={handlePassionneeClick}
                      className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-sky-700 transition-all shadow-md shadow-sky-900/10 active:scale-95"
                    >
                      {language === 'fr' ? "Débloquer l'illimité — 4,99€ / mois" : "Unlock Unlimited — €4.99 / month"}
                    </button>
                    <p className="text-[10px] text-slate-400 italic"> Sans engagement, résiliable en 1 clic</p>
                  </div>

                  {/* Offre Centre de Plongée */}
                  <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-5 flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-cyan-400" />
                      <span className="font-bold text-cyan-500">{language === 'fr' ? 'Centre de Plongée' : 'Dive Center'}</span>
                    </div>
                    <p className="text-xs text-slate-400 px-4">
                      {language === 'fr' 
                        ? "Valorisez votre image de marque sur les souvenirs PDF de vos plongeurs." 
                        : "Enhance your brand image on your divers' PDF memories."}
                    </p>
                    <button 
                      onClick={() => {
                        // For demo purposes, we allow the user to activate center mode to see the effect
                        if (confirm(language === 'fr' ? "Voulez-vous simuler l'activation du mode CENTRE pour tester vos logos ?" : "Do you want to simulate Center mode activation to test your logos?")) {
                          const docRef = doc(db, 'users', user?.uid!, 'stats', 'usage');
                          updateDoc(docRef, { isDiveCenter: true }).then(() => {
                            setUserUsage({...userUsage!, isDiveCenter: true});
                            setShowCenterSettings(true);
                          });
                        }
                      }}
                      className="w-full bg-white text-slate-900 py-3 rounded-xl font-bold text-sm hover:bg-slate-100 transition-all active:scale-95"
                    >
                      {language === 'fr' ? "Votre LOGO sur la fiche" : "Your LOGO on the report"}
                    </button>
                    <p className="text-[10px] text-slate-500">Service Pro • Fidélisation client</p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 px-6 italic">
                  {language === 'fr'
                    ? "En choisissant une offre, vous soutenez la recherche et la préservation de la biodiversité marine."
                    : "By choosing a plan, you support research and the preservation of marine biodiversity."}
                </p>
              </div>
            )}
            <button
              onClick={analyzeImage}
              disabled={!imageFile || isAnalyzing || isQuotaExceeded}
              className={`
                flex-1 py-4 px-8 rounded-lg font-bold uppercase tracking-wider text-sm flex items-center justify-center gap-3 transition-all
                ${!imageFile || isQuotaExceeded
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : isAnalyzing 
                    ? 'bg-slate-800 text-white cursor-wait opacity-80'
                    : 'bg-[#003466] text-white hover:bg-[#00284d] active:scale-[0.98] shadow-md'}
              `}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {language === 'fr' ? 'Analyse en cours...' : 'Analyzing...'}
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5" />
                  {language === 'fr' ? 'Générer la Fiche' : 'Generate Report'}
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

          {userUsage?.isDiveCenter && (
            <div className="mt-8 pt-8 border-t border-slate-100">
              <button 
                onClick={() => setShowCenterSettings(!showCenterSettings)}
                className="w-full flex items-center justify-between text-slate-700 hover:text-[#003466] transition-colors"
              >
                <div className="flex items-center gap-2 font-bold text-sm">
                  <MapPin className="w-4 h-4" />
                  {language === 'fr' ? "PARAMÈTRES DU CENTRE" : "CENTER SETTINGS"}
                </div>
                <span className="text-xs">{showCenterSettings ? '−' : '+'}</span>
              </button>
              
              {showCenterSettings && (
                <form onSubmit={handleCenterSettingsUpdate} className="mt-4 space-y-4 animate-in slide-in-from-top-2 duration-300">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nom du Centre</label>
                    <input 
                      name="centerName" 
                      defaultValue={userUsage.centerName}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500/20 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">URL du Logo (PNG de préférence)</label>
                    <input 
                      name="centerLogoUrl" 
                      defaultValue={userUsage.centerLogoUrl}
                      placeholder="https://..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500/20 outline-none"
                    />
                  </div>
                  <button className="w-full bg-slate-900 text-white py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-black transition-all">
                    {language === 'fr' ? "Enregistrer les modifications" : "Save Changes"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Right Column: PDF Preview Area */}
        <div className="flex-1 flex justify-center items-start print:block print:w-full">
          {!result && !isAnalyzing ? (
            <div className="flex-1 bg-white border border-slate-200 shadow-xl rounded-[32px] p-6 lg:p-12 min-h-[500px] flex flex-col items-center justify-center text-slate-500 text-center print:hidden">
              <Waves className="w-16 h-16 mb-4 text-slate-200" />
              <p className="text-lg font-medium text-slate-600 mb-2">{language === 'fr' ? 'Prêt pour la plongée !' : 'Ready to dive!'}</p>
              <p className="max-w-xs text-sm">{language === 'fr' ? 'Télécharge une image et je formaterai une belle fiche A4 prête à imprimer.' : 'Upload an image and I will format a beautiful A4 report ready to print.'}</p>
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
                
                <div className="flex-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-[#003466] tracking-tight font-serif uppercase">
                    {language === 'fr' ? 'Guide d’identification' : 'Identification Guide'}
                  </h1>
                  <p className="text-xs text-slate-400 font-bold tracking-widest uppercase mt-0.5">Diving Aware</p>
                </div>

                {userUsage?.isDiveCenter && userUsage.centerLogoUrl && (
                  <div className="flex flex-col items-center gap-1 border-l-2 border-slate-100 pl-6">
                    <div className="w-20 h-20 flex items-center justify-center shrink-0 overflow-hidden">
                      <img 
                        src={userUsage.centerLogoUrl} 
                        alt={userUsage.centerName || 'Center Logo'} 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    {userUsage.centerName && (
                      <p className="text-[9px] font-bold text-[#003466] uppercase tracking-[0.1em]">{userUsage.centerName}</p>
                    )}
                  </div>
                )}
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
                          {language === 'fr' ? 'Confiance' : 'Confidence'} : {org.confiance}
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

              <div className="grid grid-cols-1 border border-slate-200 rounded-xl p-4 bg-sky-50 text-xs mt-6">
                 <p className="font-bold text-sky-900 mb-1">
                   {language === 'fr' ? "Différence animal / végétal :" : "Animal / Plant difference:"}
                 </p>
                 <ul className="list-disc list-inside text-slate-700 ml-1 space-y-0.5">
                   <li><strong>{language === 'fr' ? "Animal" : "Animal"} :</strong> {language === 'fr' ? "mange de la nourriture, parfois bouge." : "eats food, sometimes moves."}</li>
                   <li><strong>{language === 'fr' ? "Végétal / algue" : "Plant / Algae"} :</strong> {language === 'fr' ? "utilise la lumière (photosynthèse)." : "uses light (photosynthesis)."}</li>
                 </ul>
              </div>

              {/* Message Impact */}
              <div className="mt-8 text-center">
                <p className="text-base sm:text-lg font-serif italic text-sky-800 font-medium px-4 py-3 bg-sky-50/50 rounded-lg inline-block border border-sky-100">
                  {language === 'fr' 
                    ? '"Sous l\'eau, ce qui semble immobile est souvent vivant."' 
                    : '"Underwater, what seems immobile is often alive."'}
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
              <p className="text-lg font-medium text-slate-600 mb-2">{language === 'fr' ? 'Création de la fiche A4...' : 'Creating A4 report...'}</p>
              <p className="text-sm">{language === 'fr' ? "Veuillez patienter pendant l'analyse de l'image." : 'Please wait while analyzing the image.'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer / IP Protection */}
      <footer className="w-full mt-20 pb-12 px-6 border-t border-slate-100 print:hidden text-center sticky top-[100vh]">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-6">
          <div className="w-12 h-12 mt-12 bg-white flex items-center justify-center shrink-0 overflow-hidden grayscale opacity-30">
            <img 
              src="https://diving-aware.com/wp-content/uploads/2025/04/cropped-cropped-E35D7D51-DC59-4B05-99D3-695D95446040-1.png" 
              alt="Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-900 tracking-tight">Diving Aware</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-[0.2em]">© {new Date().getFullYear()} – Identification de la biodiversité marine</p>
          </div>
          <div className="flex gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest flex-wrap justify-center">
            <button type="button" onClick={() => setLegalView('legal')} className="hover:text-[#003466] transition-colors cursor-pointer">{language === 'fr' ? 'Mentions Légales' : 'Legal Notice'}</button>
            <button type="button" onClick={() => setLegalView('cookies')} className="hover:text-[#003466] transition-colors cursor-pointer">{language === 'fr' ? 'Cookies' : 'Cookies Policy'}</button>
            <button type="button" onClick={() => setLegalView('cgu')} className="hover:text-[#003466] transition-colors cursor-pointer">CGU</button>
            <a href="mailto:pjl.galland@gmail.com" className="hover:text-[#003466] transition-colors">Contact</a>
          </div>
          <p className="max-w-md text-[10px] text-slate-400 italic font-serif leading-relaxed px-6">
            {language === 'fr' 
              ? "Le contenu de ce site, incluant les méthodes de mise en page et les formats de rapports générés, est protégé par le droit de la propriété intellectuelle. Toute reproduction est interdite sans accord écrit." 
              : "The content of this site, including layout methods and generated report formats, is protected by intellectual property law. Reproduction is prohibited without written agreement."}
          </p>
        </div>
      </footer>
    </div>
  );
}
