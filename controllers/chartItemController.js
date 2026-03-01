const ChartItem = require("../models/ChartItem");

const createChartItem = async (req, res, next) => {
  try {
    const chart = await ChartItem.create(req.body);
    res.status(201).json(chart);
  } catch (error) {
    next(error);
  }
};

const getChartItems = async (req, res, next) => {
  try {
    const charts = await ChartItem.getUserCharts(
      req.user.id,
      req.user.selectedGenres
    );

    res.json(charts);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createChartItem,
  getChartItems
};
