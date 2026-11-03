const { request, showError, formatDate } = require("../../utils/api");

Page({
  data: {
    certificates: [],
  },

  onLoad() {
    this.loadCertificates();
  },

  async loadCertificates() {
    try {
      const payload = await request("/api/me/certificates");
      this.setData({
        certificates: payload.items.map((item) => ({
          ...item,
          dateText: formatDate(item.eventStartsAt),
          issuedText: formatDate(item.issuedAt),
          finishText: this.formatDuration(item.finishTimeSeconds),
        })),
      });
    } catch (error) {
      showError(error);
    }
  },

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return [hours, minutes, rest]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  },

  downloadCertificate(event) {
    const certificate = this.data.certificates.find(
      (item) => item.id === event.currentTarget.dataset.id,
    );
    wx.showModal({
      title: certificate.eventTitle,
      content: `证书编号：${certificate.serialNo}\n完赛时间：${certificate.finishText}\n电子证书下载将在后续接入对象存储。`,
      showCancel: false,
    });
  },
});
