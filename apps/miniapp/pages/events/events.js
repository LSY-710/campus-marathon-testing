const { request, showError, formatDate, money } = require("../../utils/api");

Page({
  data: {
    keyword: "",
    status: "ALL",
    tabs: [
      { key: "ALL", label: "全部" },
      { key: "REGISTERING", label: "报名中" },
      { key: "ENDED", label: "已结束" },
      { key: "UPCOMING", label: "未开始" },
    ],
    events: [],
    loading: true,
  },

  onLoad() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearch() {
    this.loadEvents();
  },

  selectStatus(event) {
    this.setData({ status: event.currentTarget.dataset.status }, () => {
      this.loadEvents();
    });
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const params = [`pageSize=50`, `status=${this.data.status}`];
      if (this.data.keyword.trim()) {
        params.push(`q=${encodeURIComponent(this.data.keyword.trim())}`);
      }
      const payload = await request(`/api/events?${params.join("&")}`);
      this.setData({
        events: payload.items.map((event, index) => ({
          ...event,
          order: String(index + 1).padStart(2, "0"),
          dateText: formatDate(event.startsAt),
          monthText: `${new Date(event.startsAt).getMonth() + 1}月`,
          dayText: String(new Date(event.startsAt).getDate()).padStart(2, "0"),
          priceText: money(event),
          statusClass: `ui-pill-${event.status.toLowerCase()}`,
        })),
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      showError(error);
    }
  },

  openEvent(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}`,
    });
  },
});
