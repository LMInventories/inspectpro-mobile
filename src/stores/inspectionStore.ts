import { create } from 'zustand'
import {
  getLocalInspections,
  getLocalInspection,
  updateReportData,
  deleteLocalInspection,
} from '../services/database'

interface InspectionStore {
  inspections: any[]
  activeInspection: any | null
  loadInspections: () => void
  loadInspection: (id: number) => void
  setReportData: (inspectionId: number, reportData: any) => void
  updateSectionInReport: (inspectionId: number, sectionKey: string, sectionData: any) => void
  updateItemInReport: (inspectionId: number, sectionKey: string, itemKey: string, itemData: any) => void
  removeInspection: (id: number) => void
}

export const useInspectionStore = create<InspectionStore>((set, get) => ({
  inspections: [],
  activeInspection: null,

  loadInspections: () => {
    const inspections = getLocalInspections()
    set({ inspections })
  },

  loadInspection: (id) => {
    const inspection = getLocalInspection(id)
    set({ activeInspection: inspection })
  },

  setReportData: (inspectionId, reportData) => {
    const json = typeof reportData === 'string' ? reportData : JSON.stringify(reportData)
    updateReportData(inspectionId, json)
    const { activeInspection } = get()
    if (activeInspection?.id === inspectionId) {
      set({ activeInspection: { ...activeInspection, report_data: json } })
    }
  },

  updateSectionInReport: (inspectionId, sectionKey, sectionData) => {
    const inspection = getLocalInspection(inspectionId)
    if (!inspection) return
    const reportData = inspection.report_data ? JSON.parse(inspection.report_data) : {}
    reportData[sectionKey] = sectionData
    get().setReportData(inspectionId, reportData)
  },

  updateItemInReport: (inspectionId, sectionKey, itemKey, itemData) => {
    const inspection = getLocalInspection(inspectionId)
    if (!inspection) return
    const reportData = inspection.report_data ? JSON.parse(inspection.report_data) : {}
    if (!reportData[sectionKey]) reportData[sectionKey] = {}
    if (!reportData[sectionKey].items) reportData[sectionKey].items = {}
    reportData[sectionKey].items[itemKey] = {
      ...(reportData[sectionKey]?.items?.[itemKey] || {}),
      ...itemData,
    }
    get().setReportData(inspectionId, reportData)
  },

  removeInspection: (id) => {
    deleteLocalInspection(id)
    const inspections = getLocalInspections()
    set({ inspections })
  },
}))
