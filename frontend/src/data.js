// Built-in sample cases, diagrams and external tool links.

export const SAMPLE_CASES = [
  { id: 'stemi', label: 'Chest pain (STEMI)', text: "45-year-old male presenting to the ED with acute substernal chest pain radiating to his left arm for the past 2 hours. Associated diaphoresis and shortness of breath.\n\nPMH: Hypertension (10 years), Type 2 Diabetes Mellitus (5 years), Hyperlipidemia\nMedications: Metformin 1000mg BID, Lisinopril 20mg daily, Atorvastatin 40mg daily, Aspirin 81mg daily\n\nVitals: BP 160/95, HR 110, RR 22, Temp 98.6°F, SpO2 94% on RA\nLabs: Troponin I 0.82 ng/mL (ref < 0.04), WBC 11.2, Glucose 245, Creatinine 1.1\nECG: ST-elevation in leads V1-V4, reciprocal changes in II, III, aVF\n\nAllergies: Sulfa drugs, Shellfish\nAlert, anxious, clutching chest. Lungs clear bilaterally. S3 gallop noted." },
  { id: 'stroke', label: 'Acute stroke', text: "72-year-old female brought by EMS with sudden onset confusion, right-sided weakness, and slurred speech. Onset 45 min ago.\n\nPMH: Atrial fibrillation (warfarin), CHF (EF 35%), CKD Stage 3\nMedications: Warfarin 5mg daily, Metoprolol 50mg BID, Furosemide 40mg daily\n\nVitals: BP 185/105, HR 88 irregular, RR 18, Temp 98.2°F, SpO2 96%\nLabs: INR 2.8, Glucose 130, Creatinine 1.8\nNIHSS: 14, GCS 13 (E3V4M6)\n\nRight facial droop, right arm drift, unable to lift right leg, dysarthria.\nAllergies: Penicillin" },
  { id: 'pe', label: 'Pulmonary embolism', text: "28-year-old female, 3-day progressive dyspnea, pleuritic chest pain, low-grade fever. Recent 12-hour flight from Australia.\n\nPMH: Combined OCP use, BMI 32\nVitals: BP 118/76, HR 112, RR 24, Temp 100.4°F, SpO2 91% on RA\nLabs: D-dimer 2.4 μg/mL (ref < 0.5), WBC 11.8, Troponin 0.06\n\nLeft calf swelling +2cm, tender. Decreased breath sounds left base.\nAllergies: NKDA" },
];

export const SAMPLE_FHIR = {"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient","name":[{"given":["John"],"family":"Doe"}],"gender":"male","birthDate":"1978-06-15"}},{"resource":{"resourceType":"Condition","code":{"coding":[{"system":"http://snomed.info/sct","code":"38341003","display":"Hypertension"}],"text":"Hypertension"},"clinicalStatus":{"coding":[{"code":"active"}]}}},{"resource":{"resourceType":"Condition","code":{"coding":[{"system":"http://snomed.info/sct","code":"44054006","display":"Type 2 Diabetes Mellitus"}],"text":"Type 2 Diabetes Mellitus"},"clinicalStatus":{"coding":[{"code":"active"}]}}},{"resource":{"resourceType":"Condition","code":{"coding":[{"system":"http://snomed.info/sct","code":"55822004","display":"Hyperlipidemia"}],"text":"Hyperlipidemia"}}},{"resource":{"resourceType":"MedicationRequest","medicationCodeableConcept":{"text":"Metformin 1000mg"},"dosageInstruction":[{"text":"1000mg BID"}],"status":"active"}},{"resource":{"resourceType":"MedicationRequest","medicationCodeableConcept":{"text":"Lisinopril 20mg"},"dosageInstruction":[{"text":"20mg daily"}],"status":"active"}},{"resource":{"resourceType":"MedicationRequest","medicationCodeableConcept":{"text":"Atorvastatin 40mg"},"dosageInstruction":[{"text":"40mg daily"}],"status":"active"}},{"resource":{"resourceType":"MedicationRequest","medicationCodeableConcept":{"text":"Aspirin 81mg"},"dosageInstruction":[{"text":"81mg daily"}],"status":"active"}},{"resource":{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"85354-9","display":"Blood Pressure"}]},"valueString":"160/95 mmHg"}},{"resource":{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"8867-4","display":"Heart Rate"}]},"valueQuantity":{"value":110,"unit":"bpm"}}},{"resource":{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"10839-9","display":"Troponin I"}]},"valueQuantity":{"value":0.82,"unit":"ng/mL"},"referenceRange":[{"high":{"value":0.04,"unit":"ng/mL"}}]}},{"resource":{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"2345-7","display":"Glucose"}]},"valueQuantity":{"value":245,"unit":"mg/dL"}}},{"resource":{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"2160-0","display":"Creatinine"}]},"valueQuantity":{"value":1.1,"unit":"mg/dL"}}},{"resource":{"resourceType":"AllergyIntolerance","code":{"text":"Sulfa drugs"},"reaction":[{"severity":"severe"}]}},{"resource":{"resourceType":"AllergyIntolerance","code":{"text":"Shellfish"},"reaction":[{"severity":"moderate"}]}}]};

export const SAMPLE_CSV = `patient_id,age,gender,condition,medication,dosage,lab_name,lab_value,lab_unit,allergy,vital_name,vital_value
P003,45,male,Hypertension,Metformin,1000mg BID,Troponin I,0.82,ng/mL,,BP,160/95
P003,45,male,Type 2 Diabetes,Lisinopril,20mg daily,WBC,11.2,K/uL,Sulfa drugs,HR,110
P003,45,male,Hyperlipidemia,Atorvastatin,40mg daily,Glucose,245,mg/dL,Shellfish,RR,22
P003,45,male,,Aspirin,81mg daily,Creatinine,1.1,mg/dL,,SpO2,94%
P003,45,male,,,,HbA1c,8.2,%,,Temp,98.6`;

export const CLASSIFIERS = [
  { id: 'lung', name: 'Lung disease', desc: 'Chest X-ray classification', url: 'https://lung-disease-classification.streamlit.app/', icon: 'activity', tone: 'blue' },
  { id: 'chest', name: 'Chest disease', desc: 'Multi-label chest findings', url: 'https://caryaai.streamlit.app/', icon: 'heart', tone: 'violet' },
  { id: 'retina', name: 'Retina analyser', desc: 'Diabetic retinopathy grading', url: 'https://retinopathy-detection.streamlit.app/', icon: 'eye', tone: 'emerald' },
  { id: 'skin', name: 'Skin lesion', desc: 'Lesion and melanoma classification', url: 'https://skincancer-detection.streamlit.app/', icon: 'microscope', tone: 'amber' },
];

export const ARCH_DIAGRAM = `graph TB
  subgraph Input["Input"]
    direction TB
    A1[Text or voice]
    A2[FHIR R4 bundle]
    A3[PDF or CSV record]
    A4[Presidio anonymizer]
    A1-->A4; A2-->A4; A3-->A4
  end
  subgraph Agents["Agents"]
    direction TB
    B1[Clinical]
    B2[Literature]
    B3[Safety]
    B4[Critic]
    B1-->B4; B2-->B4; B3-->B4
  end
  subgraph Output["Output"]
    C1[SOAP note]; C2[Differentials]; C3[Safety alerts]; C4[Risk scores]
  end
  A4-->B1; A4-->B2; A4-->B3
  B4-->C1; B4-->C2; B4-->C3; B4-->C4
  subgraph External["External sources"]
    E1[PubMed]; E2[openFDA]; E3[RxNorm]; E4[DrugBank]
  end
  B2-.->E1; B3-.->E2; B3-.->E3; B3-.->E4`;

export const FLOW_DIAGRAM = `sequenceDiagram
  participant D as Clinician
  participant F as Browser
  participant B as Server
  participant C as Clinical
  participant L as Literature
  participant S as Safety
  participant K as Critic
  D->>F: Enter or dictate a case
  F->>B: Start run (WebSocket)
  B->>B: Anonymize (Presidio)
  B->>C: Clinical reasoning
  C-->>B: Differentials and SOAP draft
  par In parallel
    B->>L: PubMed search
    B->>S: Drug safety review
  end
  L-->>B: Evidence and citations
  S-->>B: Interactions and flags
  B->>K: Critic review
  K-->>B: Consensus or dissent
  B->>B: Synthesize SOAP note
  B-->>F: Live progress and final report
  F-->>D: Report and safety alerts
  Note over D,K: Clinician feedback starts a new review`;
